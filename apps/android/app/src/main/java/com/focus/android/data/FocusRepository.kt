package com.focus.android.data

import android.content.ContentResolver
import android.net.Uri
import android.os.Build
import com.focus.android.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.WebSocket
import java.net.URI
import java.security.SecureRandom
import java.time.Instant

data class AppState(
    val loggedIn: Boolean = false,
    val tasks: List<TaskDto> = emptyList(),
    val pendingCaptures: Int = 0,
    val suggestionCount: Int = 0,
    val online: Boolean = false,
    val apiUrl: String = BuildConfig.DEFAULT_API_URL,
    val profile: UserProfileDto? = null,
    val spheres: List<String> = listOf("work", "personal"),
)

class FocusRepository(
    private val session: SessionStore,
    private val dao: FocusDao,
    private val api: ApiClient,
    private val scope: CoroutineScope,
) {
    private var socket: WebSocket? = null
    private var socketJob: Job? = null
    private var mutableSuggestionCount = kotlinx.coroutines.flow.MutableStateFlow(0)
    private var mutableOnline = kotlinx.coroutines.flow.MutableStateFlow(false)
    private var mutableProfile = kotlinx.coroutines.flow.MutableStateFlow<UserProfileDto?>(null)
    private data class BaseState(
        val token: String?,
        val tasks: List<TaskEntity>,
        val pendingCaptures: Int,
    )

    private val baseState = combine(
        session.token,
        dao.observeTasks(),
        dao.observePendingCount(),
    ) { token, tasks, pending -> BaseState(token, tasks, pending) }

    val state: Flow<AppState> = combine(
        baseState,
        mutableSuggestionCount,
        mutableOnline,
        mutableProfile,
        session.apiUrl,
    ) { base, suggestions, online, profile, apiUrl ->
        AppState(
            loggedIn = !base.token.isNullOrBlank(),
            tasks = base.tasks.map { it.toDto() },
            pendingCaptures = base.pendingCaptures,
            suggestionCount = suggestions,
            online = online,
            apiUrl = apiUrl,
            profile = profile,
            spheres = profile?.spheres?.takeIf { it.isNotEmpty() } ?: listOf("work", "personal"),
        )
    }

    suspend fun login(username: String, password: String) {
        val auth = api.login(username, password)
        session.saveAuth(auth.token)
        startupSync()
        startRealtime()
        registerDevice(pushToken = null)
    }

    suspend fun register(username: String, password: String) {
        val auth = api.register(username, password)
        session.saveAuth(auth.token)
        startupSync()
        startRealtime()
        registerDevice(pushToken = null)
    }

    suspend fun logout() {
        session.currentDeviceId()?.let { runCatching { api.disableDevice(it) } }
        socket?.close(1000, "logout")
        session.clearAuth()
        dao.clearTasks()
        mutableProfile.value = null
        mutableOnline.value = false
        mutableSuggestionCount.value = 0
    }

    suspend fun setApiUrl(url: String) {
        val normalized = url.trim().trimEnd('/')
        val parsed = runCatching { URI(normalized) }.getOrNull()
        require(
            parsed != null &&
                parsed.scheme in setOf("http", "https") &&
                !parsed.host.isNullOrBlank(),
        ) { "Server must be a valid http:// or https:// URL" }
        session.saveApiUrl(normalized)
    }

    suspend fun refresh() {
        runCatching { mutableProfile.value = api.profile() }
        val sync = api.sync(session.currentSyncCursor())
        dao.upsertTasks(sync.tasks.map { it.toEntity() })
        session.saveSyncCursor(sync.nextCursor)
        mutableSuggestionCount.value = sync.suggestionCount
        mutableOnline.value = true
    }

    suspend fun startupSync() {
        refresh()
        runCatching { api.refreshSlackDigest(force = false) }
    }

    suspend fun fullRefresh() {
        runCatching { mutableProfile.value = api.profile() }
        val list = api.listTasks()
        dao.clearTasks()
        dao.upsertTasks(list.tasks.map { it.toEntity() })
        mutableSuggestionCount.value = api.listSuggestions().suggestions.size
        mutableOnline.value = true
    }

    suspend fun capture(rawInput: String) {
        val clientId = newUlid()
        try {
            val created = api.createTask(rawInput, clientId)
            dao.upsertTask(created.toEntity())
            mutableOnline.value = true
        } catch (e: Exception) {
            val now = Instant.now().toString()
            dao.enqueueCapture(PendingCaptureEntity(clientId, rawInput, now))
            dao.upsertTask(
                TaskEntity(
                    id = clientId,
                    userId = "",
                    rawInput = rawInput,
                    title = rawInput,
                    titleOverridden = false,
                    sphere = mutableProfile.value?.spheres?.firstOrNull() ?: "personal",
                    sphereOverridden = false,
                    tags = emptyList(),
                    status = "inbox",
                    dueAt = null,
                    dueAtOverridden = false,
                    priority = "P2",
                    priorityScore = 50,
                    priorityOverridden = false,
                    enrichedAt = null,
                    aiSuggestion = null,
                    aiSuggestionDetail = null,
                    subtaskCount = 0,
                    subtaskDone = 0,
                    createdAt = now,
                    updatedAt = now,
                    pending = true,
                ),
            )
            mutableOnline.value = false
        }
    }

    suspend fun chat(messages: List<AssistantMessageDto>): String {
        val reply = api.chat(messages).reply
        fullRefresh()
        return reply
    }

    suspend fun replayPendingCaptures() {
        for (pending in dao.pendingCaptures()) {
            runCatching {
                val task = api.createTask(pending.rawInput, pending.clientId)
                dao.upsertTask(task.toEntity())
                dao.deletePendingCapture(pending.clientId)
            }
        }
    }

    suspend fun updateTask(id: String, patch: UpdateTaskRequest) {
        val updated = api.updateTask(id, patch)
        dao.upsertTask(updated.toEntity())
    }

    suspend fun listSubtasks(taskId: String): List<SubtaskDto> = api.listSubtasks(taskId).subtasks

    suspend fun addSubtask(taskId: String, title: String): SubtaskDto = api.addSubtask(taskId, title)

    suspend fun updateSubtask(id: String, patch: UpdateSubtaskRequest): SubtaskDto =
        api.updateSubtask(id, patch)

    suspend fun deleteSubtask(id: String) = api.deleteSubtask(id)

    suspend fun listContext(taskId: String): List<ContextItemDto> = api.listContext(taskId).items

    suspend fun addNote(taskId: String, body: String): ContextItemDto = api.addNote(taskId, body)

    suspend fun uploadImage(taskId: String, resolver: ContentResolver, uri: Uri): ContextItemDto =
        api.uploadImage(taskId, resolver, uri)

    suspend fun attachmentUrl(attachmentKey: String): String = api.attachmentUrl(attachmentKey)

    suspend fun listSuggestions(): List<SuggestionDto> = api.listSuggestions().suggestions

    suspend fun acceptSuggestion(id: String): TaskDto {
        val task = api.acceptSuggestion(id)
        dao.upsertTask(task.toEntity())
        mutableSuggestionCount.value = api.listSuggestions().suggestions.size
        return task
    }

    suspend fun dismissSuggestion(id: String) {
        api.dismissSuggestion(id)
        mutableSuggestionCount.value = api.listSuggestions().suggestions.size
    }

    suspend fun listMemory(): MemoryResponse = api.listMemory()

    suspend fun addMemoryRecord(kind: String, content: String): MemoryRecordDto =
        api.addMemoryRecord(kind, content)

    suspend fun savePreferences(preferences: SpherePreferences) {
        api.savePreferences(preferences)
    }

    suspend fun listIntegrations(): IntegrationListResponse = api.listIntegrations()

    suspend fun updateIntegrationSphere(id: String, sphere: String?) {
        api.updateIntegrationSphere(id, sphere)
    }

    suspend fun updateSpheres(spheres: List<String>): UserProfileDto {
        val updated = api.updateSpheres(spheres)
        val profile = UserProfileDto(
            id = updated.id,
            username = updated.username,
            displayName = updated.displayName,
            avatarKey = updated.avatarKey,
            spheres = updated.spheres,
            hasAiKey = updated.hasAiKey,
            aiMode = updated.aiMode,
        )
        mutableProfile.value = profile
        return profile
    }

    suspend fun setAiKey(apiKey: String) {
        mutableProfile.value = api.setAiKey(apiKey)
    }

    suspend fun scanSuggestions() {
        api.scanSuggestions()
    }

    suspend fun slackDigest(): SlackDigestResponse = api.slackDigest()

    suspend fun refreshSlackDigest(force: Boolean) {
        api.refreshSlackDigest(force)
    }

    suspend fun registerDevice(pushToken: String?) {
        if (session.currentToken().isNullOrBlank()) return
        val existingId = session.currentDeviceId()
        val device = api.registerDevice(
            RegisterDeviceRequest(
                id = existingId,
                name = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                pushToken = pushToken,
                appVersion = BuildConfig.VERSION_NAME,
                osVersion = Build.VERSION.RELEASE,
            ),
        )
        session.saveDeviceId(device.id)
    }

    fun startRealtime() {
        if (socketJob?.isActive == true) return
        socketJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                if (session.currentToken().isNullOrBlank()) {
                    delay(2_000)
                    continue
                }
                socket = runCatching {
                    api.openWebSocket(::applySyncMessage) {
                        mutableOnline.value = false
                    }
                }.getOrNull()
                delay(30_000)
            }
        }
    }

    private fun applySyncMessage(message: SyncMessage) {
        scope.launch {
            when (message.type) {
                "task.upserted" -> message.task?.let { dao.upsertTask(it.toEntity()) }
                "task.deleted" -> message.id?.let { dao.deleteTask(it) }
                "suggestion.changed" -> mutableSuggestionCount.value = api.listSuggestions().suggestions.size
                "suggestion.new" -> mutableSuggestionCount.value += 1
                "notification" -> Unit
            }
            mutableOnline.value = true
        }
    }
}

private val ulidRandom = SecureRandom()
private val ulidAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray()

fun newUlid(now: Long = System.currentTimeMillis()): String {
    val chars = CharArray(26)
    var time = now
    for (i in 9 downTo 0) {
        chars[i] = ulidAlphabet[(time and 31).toInt()]
        time = time ushr 5
    }
    val bytes = ByteArray(10)
    ulidRandom.nextBytes(bytes)
    var bitBuffer = 0
    var bitCount = 0
    var out = 10
    for (byte in bytes) {
        bitBuffer = (bitBuffer shl 8) or (byte.toInt() and 0xff)
        bitCount += 8
        while (bitCount >= 5 && out < 26) {
            bitCount -= 5
            chars[out++] = ulidAlphabet[(bitBuffer shr bitCount) and 31]
        }
    }
    while (out < 26) chars[out++] = ulidAlphabet[ulidRandom.nextInt(32)]
    return String(chars)
}
