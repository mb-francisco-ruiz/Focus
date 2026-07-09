@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package com.focus.android.data

import android.content.ContentResolver
import android.net.Uri
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.IOException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ApiClient(
    private val session: SessionStore,
    private val http: OkHttpClient = OkHttpClient(),
) {
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    suspend fun login(username: String, password: String): AuthResponse =
        post("/auth/login", LoginRequest(username, password), auth = false)

    suspend fun register(username: String, password: String): AuthResponse =
        post("/auth/register", RegisterRequest(username, password), auth = false)

    suspend fun profile(): UserProfileDto = get("/users/me")

    suspend fun updateSpheres(spheres: List<String>): UpdateSpheresResponse =
        put("/users/me/spheres", UpdateSpheresRequest(spheres))

    suspend fun listTasks(): TaskListResponse = get("/tasks")

    suspend fun sync(since: String?): SyncResponse =
        get(if (since.isNullOrBlank()) "/sync" else "/sync?since=${since.urlEncode()}")

    suspend fun createTask(rawInput: String, clientId: String? = null): TaskDto =
        post("/tasks", CreateTaskRequest(rawInput, clientId))

    suspend fun updateTask(id: String, patch: UpdateTaskRequest): TaskDto =
        patch("/tasks/$id", patch)

    suspend fun listSubtasks(taskId: String): SubtaskListResponse = get("/tasks/$taskId/subtasks")

    suspend fun addSubtask(taskId: String, title: String): SubtaskDto =
        post("/tasks/$taskId/subtasks", CreateSubtaskRequest(title))

    suspend fun updateSubtask(id: String, patch: UpdateSubtaskRequest): SubtaskDto =
        patch("/subtasks/$id", patch)

    suspend fun deleteSubtask(id: String) {
        delete("/subtasks/$id")
    }

    suspend fun listContext(taskId: String): ContextListResponse = get("/tasks/$taskId/context")

    suspend fun addNote(taskId: String, body: String): ContextItemDto =
        post("/tasks/$taskId/context", AddContextRequest("text", body))

    suspend fun uploadImage(
        taskId: String,
        resolver: ContentResolver,
        uri: Uri,
    ): ContextItemDto {
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IOException("unable to read image")
        val part = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file",
                uri.lastPathSegment ?: "attachment.jpg",
                bytes.toRequestBody("image/jpeg".toMediaType()),
            )
            .build()
        val request = request("/tasks/$taskId/attachments")
            .post(part)
            .build()
        return execute(request)
    }

    suspend fun listSuggestions(): SuggestionListResponse = get("/suggestions")

    suspend fun acceptSuggestion(id: String): TaskDto = postEmpty("/suggestions/$id/accept")

    suspend fun dismissSuggestion(id: String) {
        postNoContent("/suggestions/$id/dismiss")
    }

    suspend fun scanSuggestions(): SlackDigestRefreshResponse = postEmpty("/suggestions/scan")

    suspend fun listMemory(): MemoryResponse = get("/memory")

    suspend fun addMemoryRecord(kind: String, content: String): MemoryRecordDto =
        post("/memory", AddMemoryRecordRequest(kind, content))

    suspend fun savePreferences(preferences: SpherePreferences): PreferencesResponse =
        put("/memory/preferences", preferences)

    suspend fun listIntegrations(): IntegrationListResponse = get("/integrations")

    suspend fun updateIntegrationSphere(id: String, sphere: String?): UpdateIntegrationResponse =
        put("/integrations/$id", UpdateIntegrationRequest(sphere))

    suspend fun disconnectIntegration(id: String) {
        delete("/integrations/$id")
    }

    suspend fun slackDigest(): SlackDigestResponse = get("/slack/digest")

    suspend fun refreshSlackDigest(force: Boolean): SlackDigestRefreshResponse =
        post("/slack/digest/refresh", SlackDigestRefreshRequest(force))

    suspend fun registerDevice(request: RegisterDeviceRequest): DeviceInfo =
        post("/devices", request)

    suspend fun disableDevice(id: String) {
        delete("/devices/$id")
    }

    suspend fun attachmentUrl(attachmentKey: String): String {
        val token = session.currentToken().orEmpty()
        return "${session.currentApiUrl()}/attachments/$attachmentKey?token=${token.urlEncode()}"
    }

    suspend fun openWebSocket(listener: (SyncMessage) -> Unit, onClosed: () -> Unit): WebSocket {
        val httpUrl = session.currentApiUrl()
        val wsUrl = httpUrl.replaceFirst("http://", "ws://").replaceFirst("https://", "wss://")
        val request = Request.Builder()
            .url("$wsUrl/ws?token=${session.currentToken().orEmpty().urlEncode()}")
            .build()
        return http.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    runCatching { json.decodeFromString<SyncMessage>(text) }.getOrNull()?.let(listener)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = onClosed()

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = onClosed()
            },
        )
    }

    private suspend inline fun <reified T> get(path: String): T =
        execute(request(path).get().build())

    private suspend inline fun <reified Req, reified Res> post(path: String, body: Req, auth: Boolean = true): Res =
        execute(request(path, auth).post(jsonBody(body)).build())

    private suspend inline fun <reified Res> postEmpty(path: String): Res =
        execute(request(path).post(ByteArray(0).toRequestBody()).build())

    private suspend fun postNoContent(path: String) {
        executeNoBody(request(path).post(ByteArray(0).toRequestBody()).build())
    }

    private suspend inline fun <reified Req, reified Res> patch(path: String, body: Req): Res =
        execute(request(path).patch(jsonBody(body)).build())

    private suspend inline fun <reified Req, reified Res> put(path: String, body: Req): Res =
        execute(request(path).put(jsonBody(body)).build())

    private suspend fun delete(path: String) {
        executeNoBody(request(path).delete().build())
    }

    private suspend fun request(path: String, auth: Boolean = true): Request.Builder {
        val builder = Request.Builder().url("${session.currentApiUrl()}$path")
        if (auth) session.currentToken()?.let { builder.header("Authorization", "Bearer $it") }
        return builder
    }

    private inline fun <reified T> jsonBody(value: T) =
        json.encodeToString(value).toRequestBody("application/json".toMediaType())

    private suspend inline fun <reified T> execute(request: Request): T =
        kotlinx.coroutines.suspendCancellableCoroutine { cont ->
            http.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (cont.isActive) cont.resumeWith(Result.failure(e))
                }

                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (!it.isSuccessful) {
                            cont.resumeWith(Result.failure(IOException("HTTP ${it.code}: ${it.body?.string()}")))
                            return
                        }
                        val body = it.body?.string().orEmpty()
                        cont.resumeWith(Result.success(json.decodeFromString<T>(body)))
                    }
                }
            })
        }

    private suspend fun executeNoBody(request: Request) =
        kotlinx.coroutines.suspendCancellableCoroutine { cont ->
            http.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (cont.isActive) cont.resumeWith(Result.failure(e))
                }

                override fun onResponse(call: Call, response: Response) {
                    response.close()
                    if (response.isSuccessful) cont.resumeWith(Result.success(Unit))
                    else cont.resumeWith(Result.failure(IOException("HTTP ${response.code}")))
                }
            })
        }
}

private fun String.urlEncode(): String =
    java.net.URLEncoder.encode(this, Charsets.UTF_8.name())
