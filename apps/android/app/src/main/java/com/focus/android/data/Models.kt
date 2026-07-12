package com.focus.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val displayName: String? = null,
)

@Serializable
data class UserProfileDto(
    val id: String,
    val username: String? = null,
    val displayName: String? = null,
    val avatarKey: String? = null,
    val spheres: List<String> = listOf("work", "personal"),
    val hasAiKey: Boolean = false,
    val aiMode: String = "server",
)

@Serializable
data class SetAiKeyRequest(val apiKey: String)

@Serializable
data class UpdateSpheresRequest(val spheres: List<String>)

@Serializable
data class UpdateSpheresResponse(
    val id: String,
    val username: String? = null,
    val displayName: String? = null,
    val avatarKey: String? = null,
    val spheres: List<String> = listOf("work", "personal"),
    val reassigned: Int,
    val hasAiKey: Boolean = false,
    val aiMode: String = "server",
)

@Serializable
data class AuthResponse(
    val token: String,
    val user: UserDto,
)

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
)

@Serializable
data class RegisterRequest(
    val username: String,
    val password: String,
)

@Serializable
data class TaskDto(
    val id: String,
    val userId: String,
    val rawInput: String,
    val title: String,
    val titleOverridden: Boolean,
    val sphere: String,
    val sphereOverridden: Boolean,
    val tags: List<String> = emptyList(),
    val status: String,
    val dueAt: String? = null,
    val dueAtOverridden: Boolean,
    val priority: String,
    val priorityScore: Int,
    val priorityOverridden: Boolean,
    val enrichedAt: String? = null,
    val aiSuggestion: String? = null,
    val aiSuggestionDetail: AiSuggestionDetail? = null,
    val subtaskCount: Int,
    val subtaskDone: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class AiSuggestionDetail(
    val what: String,
    val why: String,
    val `when`: String,
)

@Serializable
data class TaskListResponse(val tasks: List<TaskDto>)

@Serializable
data class CreateTaskRequest(
    val rawInput: String,
    val clientId: String? = null,
)

@Serializable
data class AssistantMessageDto(
    val role: String,
    val content: String,
)

@Serializable
data class ChatRequest(val messages: List<AssistantMessageDto>)

@Serializable
data class ChatResponse(val reply: String)

@Serializable
data class UpdateTaskRequest(
    val title: String? = null,
    val sphere: String? = null,
    val status: String? = null,
    val dueAt: String? = null,
    val priority: String? = null,
    val tags: List<String>? = null,
)

@Serializable
data class SyncResponse(
    val tasks: List<TaskDto>,
    val suggestionCount: Int,
    val nextCursor: String,
)

@Serializable
data class SubtaskDto(
    val id: String,
    val taskId: String,
    val title: String,
    val done: Boolean,
    val createdAt: String,
)

@Serializable
data class SubtaskListResponse(val subtasks: List<SubtaskDto>)

@Serializable
data class CreateSubtaskRequest(val title: String)

@Serializable
data class UpdateSubtaskRequest(
    val title: String? = null,
    val done: Boolean? = null,
)

@Serializable
data class ContextItemDto(
    val id: String,
    val taskId: String,
    val kind: String,
    val body: String? = null,
    val attachmentKey: String? = null,
    val sourceRef: JsonObject? = null,
    val createdAt: String,
)

@Serializable
data class ContextListResponse(val items: List<ContextItemDto>)

@Serializable
data class AddContextRequest(
    val kind: String,
    val body: String,
)

@Serializable
data class SuggestionDto(
    val id: String,
    val userId: String,
    val source: String,
    val accountId: String,
    val title: String,
    val reason: String,
    val excerpt: String,
    val sourceRef: JsonObject,
    val status: String,
    val taskId: String? = null,
    val createdAt: String,
)

@Serializable
data class SuggestionListResponse(val suggestions: List<SuggestionDto>)

@Serializable
data class MemoryRecordDto(
    val id: String,
    val kind: String,
    val content: String,
    val createdAt: String,
)

typealias SpherePreferences = Map<String, String>

@Serializable
data class MemoryResponse(
    val records: List<MemoryRecordDto>,
    val preferences: SpherePreferences,
)

@Serializable
data class PreferencesResponse(val preferences: SpherePreferences)

@Serializable
data class AddMemoryRecordRequest(
    val kind: String,
    val content: String,
)

@Serializable
data class IntegrationAccountDto(
    val id: String,
    val provider: String,
    val externalId: String,
    val sphere: String? = null,
    val createdAt: String,
)

@Serializable
data class IntegrationListResponse(
    val accounts: List<IntegrationAccountDto>,
    val googleConfigured: Boolean,
    val slackConfigured: Boolean,
)

@Serializable
data class UpdateIntegrationRequest(val sphere: String?)

@Serializable
data class UpdateIntegrationResponse(
    val id: String,
    val sphere: String? = null,
)

@Serializable
data class SlackDigestDto(
    val date: String,
    val content: String,
    val createdAt: String,
)

@Serializable
data class SlackDigestResponse(
    val digest: SlackDigestDto? = null,
    val excludedChannels: List<String> = emptyList(),
    val lastError: String? = null,
)

@Serializable
data class SlackDigestRefreshRequest(val force: Boolean = false)

@Serializable
data class SlackDigestRefreshResponse(val queued: Boolean)

@Serializable
data class RegisterDeviceRequest(
    val id: String? = null,
    val platform: String = "android",
    val name: String? = null,
    val pushToken: String? = null,
    val appVersion: String? = null,
    val osVersion: String? = null,
)

@Serializable
data class DeviceInfo(
    val id: String,
    val platform: String,
    val name: String? = null,
    val pushToken: String? = null,
    val appVersion: String? = null,
    val osVersion: String? = null,
    val lastSeenAt: String,
    val disabledAt: String? = null,
    val createdAt: String,
)

@Serializable
data class SyncMessage(
    val type: String,
    val task: TaskDto? = null,
    val suggestion: SuggestionDto? = null,
    val id: String? = null,
    val taskId: String? = null,
    val title: String? = null,
    val body: String? = null,
)
