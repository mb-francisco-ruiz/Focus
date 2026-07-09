package com.focus.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.focusDataStore by preferencesDataStore(name = "focus_settings")

@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val id: String,
    val userId: String,
    val rawInput: String,
    val title: String,
    val titleOverridden: Boolean,
    val sphere: String,
    val sphereOverridden: Boolean,
    val tags: List<String>,
    val status: String,
    val dueAt: String?,
    val dueAtOverridden: Boolean,
    val priority: String,
    val priorityScore: Int,
    val priorityOverridden: Boolean,
    val enrichedAt: String?,
    val aiSuggestion: String?,
    val aiSuggestionDetail: AiSuggestionDetail?,
    val subtaskCount: Int,
    val subtaskDone: Int,
    val createdAt: String,
    val updatedAt: String,
    val pending: Boolean = false,
)

@Entity(tableName = "pending_captures")
data class PendingCaptureEntity(
    @PrimaryKey val clientId: String,
    val rawInput: String,
    val capturedAt: String,
)

class FocusConverters {
    private val json = Json { ignoreUnknownKeys = true }

    @TypeConverter
    fun tagsToString(value: List<String>): String = json.encodeToString(value)

    @TypeConverter
    fun tagsFromString(value: String): List<String> = json.decodeFromString(value)

    @TypeConverter
    fun detailToString(value: AiSuggestionDetail?): String? = value?.let { json.encodeToString(it) }

    @TypeConverter
    fun detailFromString(value: String?): AiSuggestionDetail? = value?.let { json.decodeFromString(it) }
}

@Dao
interface FocusDao {
    @Query("SELECT * FROM tasks ORDER BY priorityScore DESC, createdAt DESC")
    fun observeTasks(): Flow<List<TaskEntity>>

    @Query("SELECT * FROM tasks ORDER BY priorityScore DESC, createdAt DESC")
    suspend fun tasks(): List<TaskEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTasks(tasks: List<TaskEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTask(task: TaskEntity)

    @Query("DELETE FROM tasks WHERE id = :id")
    suspend fun deleteTask(id: String)

    @Query("DELETE FROM tasks")
    suspend fun clearTasks()

    @Query("SELECT * FROM pending_captures ORDER BY capturedAt ASC")
    suspend fun pendingCaptures(): List<PendingCaptureEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueueCapture(capture: PendingCaptureEntity)

    @Query("DELETE FROM pending_captures WHERE clientId = :clientId")
    suspend fun deletePendingCapture(clientId: String)

    @Query("SELECT COUNT(*) FROM pending_captures")
    fun observePendingCount(): Flow<Int>
}

@Database(
    entities = [TaskEntity::class, PendingCaptureEntity::class],
    version = 1,
    exportSchema = false,
)
@TypeConverters(FocusConverters::class)
abstract class FocusDatabase : RoomDatabase() {
    abstract fun dao(): FocusDao

    companion object {
        @Volatile private var instance: FocusDatabase? = null

        fun get(context: Context): FocusDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    FocusDatabase::class.java,
                    "focus.db",
                ).build().also { instance = it }
            }
    }
}

class SessionStore(private val context: Context) {
    private val tokenKey = stringPreferencesKey("token")
    private val apiUrlKey = stringPreferencesKey("api_url")
    private val syncCursorKey = stringPreferencesKey("sync_cursor")
    private val deviceIdKey = stringPreferencesKey("device_id")

    val token: Flow<String?> = context.focusDataStore.data.map { it[tokenKey] }
    val apiUrl: Flow<String> = context.focusDataStore.data.map { it[apiUrlKey] ?: com.focus.android.BuildConfig.DEFAULT_API_URL }
    val syncCursor: Flow<String?> = context.focusDataStore.data.map { it[syncCursorKey] }
    val deviceId: Flow<String?> = context.focusDataStore.data.map { it[deviceIdKey] }

    suspend fun currentToken(): String? = token.first()
    suspend fun currentApiUrl(): String = apiUrl.first().trimEnd('/')
    suspend fun currentSyncCursor(): String? = syncCursor.first()
    suspend fun currentDeviceId(): String? = deviceId.first()

    suspend fun saveAuth(token: String) {
        context.focusDataStore.edit { it[tokenKey] = token }
    }

    suspend fun saveApiUrl(url: String) {
        context.focusDataStore.edit { it[apiUrlKey] = url.trimEnd('/') }
    }

    suspend fun saveSyncCursor(cursor: String) {
        context.focusDataStore.edit { it[syncCursorKey] = cursor }
    }

    suspend fun saveDeviceId(id: String) {
        context.focusDataStore.edit { it[deviceIdKey] = id }
    }

    suspend fun clearAuth() {
        context.focusDataStore.edit {
            it.remove(tokenKey)
            it.remove(syncCursorKey)
        }
    }
}

fun TaskDto.toEntity(pending: Boolean = false): TaskEntity = TaskEntity(
    id = id,
    userId = userId,
    rawInput = rawInput,
    title = title,
    titleOverridden = titleOverridden,
    sphere = sphere,
    sphereOverridden = sphereOverridden,
    tags = tags,
    status = status,
    dueAt = dueAt,
    dueAtOverridden = dueAtOverridden,
    priority = priority,
    priorityScore = priorityScore,
    priorityOverridden = priorityOverridden,
    enrichedAt = enrichedAt,
    aiSuggestion = aiSuggestion,
    aiSuggestionDetail = aiSuggestionDetail,
    subtaskCount = subtaskCount,
    subtaskDone = subtaskDone,
    createdAt = createdAt,
    updatedAt = updatedAt,
    pending = pending,
)

fun TaskEntity.toDto(): TaskDto = TaskDto(
    id = id,
    userId = userId,
    rawInput = rawInput,
    title = title,
    titleOverridden = titleOverridden,
    sphere = sphere,
    sphereOverridden = sphereOverridden,
    tags = tags,
    status = status,
    dueAt = dueAt,
    dueAtOverridden = dueAtOverridden,
    priority = priority,
    priorityScore = priorityScore,
    priorityOverridden = priorityOverridden,
    enrichedAt = enrichedAt,
    aiSuggestion = aiSuggestion,
    aiSuggestionDetail = aiSuggestionDetail,
    subtaskCount = subtaskCount,
    subtaskDone = subtaskDone,
    createdAt = createdAt,
    updatedAt = updatedAt,
)
