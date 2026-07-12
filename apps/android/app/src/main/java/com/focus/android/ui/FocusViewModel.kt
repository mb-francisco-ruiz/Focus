package com.focus.android.ui

import android.app.Application
import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.focus.android.FocusApplication
import com.focus.android.data.AppState
import com.focus.android.data.ContextItemDto
import com.focus.android.data.FocusRepository
import com.focus.android.data.MemoryRecordDto
import com.focus.android.data.SpherePreferences
import com.focus.android.data.SubtaskDto
import com.focus.android.data.SuggestionDto
import com.focus.android.data.SlackDigestResponse
import com.focus.android.data.TaskDto
import com.focus.android.data.UpdateSubtaskRequest
import com.focus.android.data.UpdateTaskRequest
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class FocusViewModel(application: Application) : AndroidViewModel(application) {
    private val repository: FocusRepository = (application as FocusApplication).repository
    val state: StateFlow<AppState> = repository.state.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        AppState(),
    )

    var selectedTaskId = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
        private set
    var subtasks = kotlinx.coroutines.flow.MutableStateFlow<List<SubtaskDto>>(emptyList())
        private set
    var contextItems = kotlinx.coroutines.flow.MutableStateFlow<List<ContextItemDto>>(emptyList())
        private set
    var suggestions = kotlinx.coroutines.flow.MutableStateFlow<List<SuggestionDto>>(emptyList())
        private set
    var memoryRecords = kotlinx.coroutines.flow.MutableStateFlow<List<MemoryRecordDto>>(emptyList())
        private set
    var preferences = kotlinx.coroutines.flow.MutableStateFlow<SpherePreferences>(emptyMap())
        private set
    var slackDigest = kotlinx.coroutines.flow.MutableStateFlow<SlackDigestResponse?>(null)
        private set
    var error = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
        private set

    fun login(username: String, password: String, apiUrl: String) = launch {
        repository.setApiUrl(apiUrl)
        repository.login(username, password)
    }

    fun register(username: String, password: String, apiUrl: String) = launch {
        repository.setApiUrl(apiUrl)
        repository.register(username, password)
    }

    fun logout() = launch { repository.logout() }

    fun setApiUrl(url: String) = launch { repository.setApiUrl(url) }

    fun refresh() = launch {
        repository.replayPendingCaptures()
        repository.startupSync()
    }

    fun capture(rawInput: String) = launch {
        repository.capture(rawInput)
    }

    fun selectTask(task: TaskDto?) = launch {
        selectedTaskId.value = task?.id
        if (task == null) {
            subtasks.value = emptyList()
            contextItems.value = emptyList()
        } else {
            subtasks.value = repository.listSubtasks(task.id)
            contextItems.value = repository.listContext(task.id)
        }
    }

    fun updateTask(id: String, patch: UpdateTaskRequest) = launch {
        repository.updateTask(id, patch)
    }

    fun addSubtask(taskId: String, title: String) = launch {
        repository.addSubtask(taskId, title)
        subtasks.value = repository.listSubtasks(taskId)
    }

    fun toggleSubtask(subtask: SubtaskDto) = launch {
        repository.updateSubtask(subtask.id, UpdateSubtaskRequest(done = !subtask.done))
        subtasks.value = repository.listSubtasks(subtask.taskId)
    }

    fun deleteSubtask(subtask: SubtaskDto) = launch {
        repository.deleteSubtask(subtask.id)
        subtasks.value = repository.listSubtasks(subtask.taskId)
    }

    fun addNote(taskId: String, body: String) = launch {
        repository.addNote(taskId, body)
        contextItems.value = repository.listContext(taskId)
    }

    fun uploadImage(taskId: String, resolver: ContentResolver, uri: Uri) = launch {
        repository.uploadImage(taskId, resolver, uri)
        contextItems.value = repository.listContext(taskId)
    }

    suspend fun attachmentUrl(attachmentKey: String): String = repository.attachmentUrl(attachmentKey)

    fun loadSuggestions() = launch {
        suggestions.value = repository.listSuggestions()
    }

    fun acceptSuggestion(id: String) = launch {
        repository.acceptSuggestion(id)
        suggestions.value = repository.listSuggestions()
    }

    fun dismissSuggestion(id: String) = launch {
        repository.dismissSuggestion(id)
        suggestions.value = repository.listSuggestions()
    }

    fun loadMemory() = launch {
        val memory = repository.listMemory()
        memoryRecords.value = memory.records
        preferences.value = memory.preferences
    }

    fun addMemory(kind: String, content: String) = launch {
        repository.addMemoryRecord(kind, content)
        loadMemory()
    }

    fun savePreferences(next: SpherePreferences) = launch {
        repository.savePreferences(next)
        preferences.value = next
    }

    fun updateSpheres(spheres: List<String>) = launch {
        repository.updateSpheres(spheres)
    }

    fun loadIntegrations(onLoaded: (com.focus.android.data.IntegrationListResponse) -> Unit) = launch {
        onLoaded(repository.listIntegrations())
    }

    fun updateIntegrationSphere(id: String, sphere: String?, after: () -> Unit = {}) = launch {
        repository.updateIntegrationSphere(id, sphere)
        after()
    }

    fun scanSuggestions() = launch {
        repository.scanSuggestions()
    }

    fun loadSlackDigest() = launch {
        slackDigest.value = repository.slackDigest()
    }

    fun refreshSlackDigest(force: Boolean = true) = launch {
        repository.refreshSlackDigest(force)
        loadSlackDigest()
    }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }
                .onFailure { error.value = it.message ?: "Something went wrong" }
        }
    }
}
