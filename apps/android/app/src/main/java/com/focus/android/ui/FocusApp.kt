@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.focus.android.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.focus.android.data.AppState
import com.focus.android.data.ContextItemDto
import com.focus.android.data.FocusRepository
import com.focus.android.data.IntegrationListResponse
import com.focus.android.data.SubtaskDto
import com.focus.android.data.SuggestionDto
import com.focus.android.data.TaskDto
import com.focus.android.data.UpdateTaskRequest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private enum class Screen(val title: String, val navLabel: String) {
    Roadmap("Roadmap", "Roadmap"),
    Todo("To do", "To do"),
    Completed("Completed", "Done"),
    Calendar("Calendar", "Calendar"),
    Suggestions("Suggestions", "Inbox"),
    Intelligence("Intelligence", "Intel"),
    Settings("Settings", "Settings"),
}

private val FocusColors = darkColorScheme(
    primary = Color(0xFFCDB4FF),
    onPrimary = Color(0xFF241638),
    secondary = Color(0xFF8EE6D2),
    tertiary = Color(0xFFFFCF7A),
    background = Color(0xFF0D0B12),
    surface = Color(0xFF17131D),
    surfaceVariant = Color(0xFF272230),
    onSurface = Color(0xFFF3EDF7),
    onSurfaceVariant = Color(0xFFC8C0D0),
    outline = Color(0xFF7A7088),
    error = Color(0xFFFF8A80),
)

@Composable
fun FocusApp(
    repository: FocusRepository,
    initialShareText: String?,
    initialShareImage: Uri?,
    initialTaskId: String?,
) {
    @Suppress("UNUSED_VARIABLE") val keepRepository = repository
    val vm: FocusViewModel = viewModel()
    val state by vm.state.collectAsState()
    val error by vm.error.collectAsState()
    var sharedImage by rememberSaveable { mutableStateOf(initialShareImage) }

    LaunchedEffect(state.loggedIn) {
        if (state.loggedIn) vm.refresh()
    }
    LaunchedEffect(initialShareText, state.loggedIn) {
        if (state.loggedIn && !initialShareText.isNullOrBlank()) vm.capture(initialShareText)
    }
    LaunchedEffect(initialTaskId, state.tasks) {
        val task = state.tasks.firstOrNull { it.id == initialTaskId }
        if (task != null) vm.selectTask(task)
    }

    MaterialTheme(colorScheme = FocusColors) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            if (!state.loggedIn) {
                LoginScreen(state, error, vm::login, vm::register, vm::setApiUrl)
            } else {
                FocusShell(state, vm, sharedImage) { sharedImage = null }
            }
        }
    }
}

@Composable
private fun LoginScreen(
    state: AppState,
    error: String?,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String) -> Unit,
    onApiUrl: (String) -> Unit,
) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var apiUrl by rememberSaveable(state.apiUrl) { mutableStateOf(state.apiUrl) }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        LogoMark()
        Spacer(Modifier.height(18.dp))
        Text("Focus", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Black)
        Text(
            "Capture, classify, and keep momentum.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyLarge,
        )
        Spacer(Modifier.height(26.dp))
        SurfaceCard {
            OutlinedTextField(apiUrl, { apiUrl = it }, label = { Text("Server") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(username, { username = it }, label = { Text("Username") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(password, { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    onApiUrl(apiUrl)
                    onLogin(username, password)
                },
                shape = CircleShape,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text("Sign in", fontWeight = FontWeight.Bold) }
            TextButton(
                onClick = {
                    onApiUrl(apiUrl)
                    onRegister(username, password)
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Create account") }
        }
        if (error != null) {
            Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp))
        }
    }
}

@Composable
private fun FocusShell(
    state: AppState,
    vm: FocusViewModel,
    sharedImage: Uri?,
    onSharedImageHandled: () -> Unit,
) {
    var screen by rememberSaveable { mutableStateOf(Screen.Roadmap) }
    val selectedId by vm.selectedTaskId.collectAsState()
    val selected = state.tasks.firstOrNull { it.id == selectedId }
    val subtasks by vm.subtasks.collectAsState()
    val contextItems by vm.contextItems.collectAsState()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            if (selected == null) {
                FocusBottomBar(
                    current = screen,
                    suggestionCount = state.suggestionCount,
                    onSelect = {
                        screen = it
                        if (it == Screen.Suggestions) vm.loadSuggestions()
                        if (it == Screen.Intelligence) vm.loadMemory()
                    },
                )
            }
        },
    ) { padding ->
        if (selected != null) {
            TaskDetailScreen(
                task = selected,
                subtasks = subtasks,
                contextItems = contextItems,
                vm = vm,
                spheres = state.spheres,
                sharedImage = sharedImage,
                onSharedImageHandled = onSharedImageHandled,
                onClose = { vm.selectTask(null) },
                modifier = Modifier.padding(padding),
            )
        } else {
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                FocusHeader(state, screen)
                SectionTabs(screen) {
                    screen = it
                    if (it == Screen.Suggestions) vm.loadSuggestions()
                    if (it == Screen.Intelligence) vm.loadMemory()
                }
                when (screen) {
                    Screen.Roadmap, Screen.Todo, Screen.Completed -> TaskBoard(state, screen, vm)
                    Screen.Calendar -> CalendarAgenda(state.tasks, vm)
                    Screen.Suggestions -> SuggestionsScreen(vm)
                    Screen.Intelligence -> IntelligenceScreen(vm)
                    Screen.Settings -> SettingsScreen(state, vm)
                }
            }
        }
    }
}

@Composable
private fun FocusHeader(state: AppState, screen: Screen) {
    Column(Modifier.padding(start = 14.dp, top = 12.dp, end = 14.dp, bottom = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LogoMark(size = 28.dp)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text("Focus", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelLarge)
                Text(screen.title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)
            }
            StatusPill(state.online)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MetricPill("${state.tasks.count { it.status != "done" && it.status != "archived" }} open")
            MetricPill("${state.tasks.count { it.status == "done" }} done")
            if (state.pendingCaptures > 0) MetricPill("${state.pendingCaptures} queued", accent = MaterialTheme.colorScheme.tertiary)
        }
    }
}

@Composable
private fun SectionTabs(current: Screen, onSelect: (Screen) -> Unit) {
    val tabs = listOf(Screen.Roadmap, Screen.Todo, Screen.Completed, Screen.Intelligence)
    Row(
        Modifier
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 14.dp, vertical = 3.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        tabs.forEach { tab ->
            Pill(
                text = tab.title,
                selected = current == tab,
                onClick = { onSelect(tab) },
            )
        }
    }
}

@Composable
private fun TaskBoard(state: AppState, screen: Screen, vm: FocusViewModel) {
    var draft by rememberSaveable { mutableStateOf("") }
    var sphere by rememberSaveable { mutableStateOf<String?>(null) }
    val tasks = state.tasks
        .filter { it.status != "archived" }
        .filter {
            when (screen) {
                Screen.Todo -> it.status != "done"
                Screen.Completed -> it.status == "done"
                else -> true
            }
        }
        .filter { sphere == null || it.sphere == sphere }
        .sortedWith(compareByDescending<TaskDto> { it.priorityScore }.thenByDescending { it.createdAt })

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 14.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (screen != Screen.Completed) {
            item {
                CaptureCard(
                    draft = draft,
                    onDraft = { draft = it },
                    onAdd = {
                        if (draft.isNotBlank()) {
                            vm.capture(draft.trim())
                            draft = ""
                        }
                    },
                )
            }
        }
        item {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Pill("All", sphere == null) { sphere = null }
                state.spheres.forEach { s -> Pill(s, sphere == s) { sphere = s } }
            }
        }
        items(tasks, key = { it.id }) { task ->
            TaskCard(task, vm)
        }
        if (tasks.isEmpty()) {
            item { EmptyState(if (screen == Screen.Completed) "No completed tasks yet." else "Nothing here right now.") }
        }
    }
}

@Composable
private fun CaptureCard(draft: String, onDraft: (String) -> Unit, onAdd: () -> Unit) {
    SurfaceCard(contentPadding = 10.dp, cornerRadius = 16.dp) {
        Text("Quick capture", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = draft,
                onValueChange = onDraft,
                placeholder = { Text("Add a task in natural language") },
                modifier = Modifier.weight(1f),
                singleLine = true,
                shape = RoundedCornerShape(13.dp),
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = onAdd,
                shape = CircleShape,
                contentPadding = PaddingValues(horizontal = 15.dp, vertical = 10.dp),
            ) { Text("Add", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge) }
        }
    }
}

@Composable
private fun TaskCard(task: TaskDto, vm: FocusViewModel) {
    val priorityColor = priorityColor(task.priority)
    Card(
        onClick = { vm.selectTask(task) },
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 11.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .width(3.dp)
                    .height(44.dp)
                    .clip(CircleShape)
                    .background(priorityColor),
            )
            Spacer(Modifier.width(9.dp))
            TaskCheck(
                checked = task.status == "done",
                onClick = {
                    vm.updateTask(task.id, UpdateTaskRequest(status = if (task.status == "done") "inbox" else "done"))
                },
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    task.title,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleSmall,
                )
                Spacer(Modifier.height(2.dp))
                Text(taskMeta(task), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(8.dp))
            PriorityPill(task.priority)
        }
    }
}

@Composable
private fun TaskDetailScreen(
    task: TaskDto,
    subtasks: List<SubtaskDto>,
    contextItems: List<ContextItemDto>,
    vm: FocusViewModel,
    spheres: List<String>,
    sharedImage: Uri?,
    onSharedImageHandled: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var title by rememberSaveable(task.id) { mutableStateOf(task.title) }
    var note by rememberSaveable(task.id) { mutableStateOf("") }
    var subtaskDraft by rememberSaveable(task.id) { mutableStateOf("") }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) vm.uploadImage(task.id, context.contentResolver, uri)
    }

    LazyColumn(
        modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onClose) { Text("Back") }
                Spacer(Modifier.weight(1f))
                PriorityPill(task.priority)
            }
            Text("Task detail", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelLarge)
            Text(task.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
        }
        item {
            SurfaceCard {
                OutlinedTextField(title, { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(10.dp))
                Button(onClick = { vm.updateTask(task.id, UpdateTaskRequest(title = title)) }, shape = CircleShape) {
                    Text("Save title")
                }
            }
        }
        item {
            SurfaceCard {
                Text("Priority", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("P1" to "High", "P2" to "Medium", "P3" to "Low").forEach { (p, label) ->
                        Pill(label, task.priority == p) { vm.updateTask(task.id, UpdateTaskRequest(priority = p)) }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Text("Category", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    spheres.forEach { s -> Pill(s, task.sphere == s) { vm.updateTask(task.id, UpdateTaskRequest(sphere = s)) } }
                }
            }
        }
        if (sharedImage != null) {
            item {
                Button(
                    onClick = {
                        vm.uploadImage(task.id, context.contentResolver, sharedImage)
                        onSharedImageHandled()
                    },
                    shape = CircleShape,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Attach shared image") }
            }
        }
        item {
            SurfaceCard {
                SectionTitle("Subtasks")
                subtasks.forEach { subtask ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        TaskCheck(subtask.done) { vm.toggleSubtask(subtask) }
                        Spacer(Modifier.width(10.dp))
                        Text(subtask.title, Modifier.weight(1f))
                        TextButton(onClick = { vm.deleteSubtask(subtask) }) { Text("Remove") }
                    }
                    Spacer(Modifier.height(6.dp))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(subtaskDraft, { subtaskDraft = it }, placeholder = { Text("Add a subtask") }, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = {
                        if (subtaskDraft.isNotBlank()) {
                            vm.addSubtask(task.id, subtaskDraft.trim())
                            subtaskDraft = ""
                        }
                    }, shape = CircleShape) { Text("Add") }
                }
            }
        }
        item {
            SurfaceCard {
                SectionTitle("Context")
                Button(onClick = { imagePicker.launch("image/*") }, shape = CircleShape) { Text("Attach image") }
                Spacer(Modifier.height(10.dp))
                contextItems.forEach { item ->
                    ContextItem(item, vm)
                    Spacer(Modifier.height(8.dp))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(note, { note = it }, placeholder = { Text("Add a note") }, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = {
                        if (note.isNotBlank()) {
                            vm.addNote(task.id, note.trim())
                            note = ""
                        }
                    }, shape = CircleShape) { Text("Add") }
                }
            }
        }
        item {
            TextButton(onClick = { vm.updateTask(task.id, UpdateTaskRequest(status = "archived")) }) {
                Text("Archive task", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun ContextItem(item: ContextItemDto, vm: FocusViewModel) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(8.dp)) {
            if (item.kind == "image" && item.attachmentKey != null) {
                val url by produceState<String?>(null, item.attachmentKey) {
                    value = vm.attachmentUrl(item.attachmentKey)
                }
                if (url == null) CircularProgressIndicator()
                else AsyncImage(model = url, contentDescription = item.body, modifier = Modifier.fillMaxWidth())
            } else {
                Text(item.body.orEmpty())
            }
            Text(formatDate(item.createdAt), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun CalendarAgenda(tasks: List<TaskDto>, vm: FocusViewModel) {
    val dated = tasks.filter { it.dueAt != null && it.status != "archived" }.sortedBy { it.dueAt }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        items(dated, key = { it.id }) { task ->
            Card(
                onClick = { vm.selectTask(task) },
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Column(Modifier.padding(11.dp)) {
                    Text(formatDate(task.dueAt!!), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(task.title, fontWeight = FontWeight.Bold)
                    Text(taskMeta(task), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (dated.isEmpty()) item { EmptyState("No dated tasks.") }
    }
}

@Composable
private fun SuggestionsScreen(vm: FocusViewModel) {
    val suggestions by vm.suggestions.collectAsState()
    LaunchedEffect(Unit) { vm.loadSuggestions() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        items(suggestions, key = { it.id }) { suggestion ->
            SuggestionCard(suggestion, vm)
        }
        if (suggestions.isEmpty()) item { EmptyState("No suggestions waiting.") }
    }
}

@Composable
private fun SuggestionCard(suggestion: SuggestionDto, vm: FocusViewModel) {
    SurfaceCard {
        Text(suggestion.source.uppercase(), color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.labelLarge)
        Text(suggestion.title, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleMedium)
        Text(suggestion.reason)
        Text(suggestion.excerpt, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 4, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(8.dp))
        Row {
            Button(onClick = { vm.acceptSuggestion(suggestion.id) }, shape = CircleShape) { Text("Create task") }
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = { vm.dismissSuggestion(suggestion.id) }) { Text("Dismiss") }
        }
    }
}

@Composable
private fun IntelligenceScreen(vm: FocusViewModel) {
    val records by vm.memoryRecords.collectAsState()
    val prefs by vm.preferences.collectAsState()
    val state by vm.state.collectAsState()
    var drafts by rememberSaveable(prefs, state.spheres) {
        mutableStateOf(state.spheres.associateWith { prefs[it].orEmpty() })
    }
    var entity by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { vm.loadMemory() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            SurfaceCard {
                SectionTitle("Behaviour")
                state.spheres.forEach { sphere ->
                    OutlinedTextField(
                        drafts[sphere].orEmpty(),
                        { value -> drafts = drafts + (sphere to value) },
                        label = { Text("$sphere instructions") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 3,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                Button(onClick = { vm.savePreferences(drafts) }, shape = CircleShape) { Text("Save behaviour") }
            }
        }
        item {
            SurfaceCard {
                SectionTitle("Teach Focus")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(entity, { entity = it }, placeholder = { Text("Entity or preference") }, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = {
                        if (entity.isNotBlank()) {
                            vm.addMemory("entity", entity.trim())
                            entity = ""
                        }
                    }, shape = CircleShape) { Text("Add") }
                }
            }
        }
        items(records, key = { it.id }) { record ->
            SurfaceCard {
                Text(record.kind, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                Text(record.content)
            }
        }
    }
}

@Composable
private fun SettingsScreen(state: AppState, vm: FocusViewModel) {
    var apiUrl by rememberSaveable(state.apiUrl) { mutableStateOf(state.apiUrl) }
    var spheresText by rememberSaveable(state.spheres) { mutableStateOf(state.spheres.joinToString(", ")) }
    var integrations by remember { mutableStateOf<IntegrationListResponse?>(null) }
    val digest by vm.slackDigest.collectAsState()
    LaunchedEffect(Unit) {
        vm.loadIntegrations { integrations = it }
        vm.loadSlackDigest()
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            SurfaceCard {
                SectionTitle("Server")
                OutlinedTextField(apiUrl, { apiUrl = it }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = { vm.setApiUrl(apiUrl) }, shape = CircleShape) { Text("Save") }
                    Spacer(Modifier.width(10.dp))
                    StatusPill(state.online)
                }
                Spacer(Modifier.height(8.dp))
                Text("Queued captures: ${state.pendingCaptures}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { vm.refresh() }) { Text("Sync now") }
            }
        }
        item {
            SurfaceCard {
                SectionTitle("Categories")
                OutlinedTextField(
                    spheresText,
                    { spheresText = it },
                    label = { Text("Comma-separated") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(onClick = {
                    val spheres = spheresText.split(",").map { it.trim().lowercase() }.filter { it.isNotBlank() }.distinct()
                    if (spheres.isNotEmpty()) vm.updateSpheres(spheres)
                }, shape = CircleShape) { Text("Save categories") }
            }
        }
        item {
            SurfaceCard {
                SectionTitle("Integrations")
                integrations?.accounts?.forEach { account ->
                    Text("${account.provider} · ${account.externalId}", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Pill("unassigned", account.sphere == null) {
                            vm.updateIntegrationSphere(account.id, null) {
                                vm.loadIntegrations { integrations = it }
                            }
                        }
                        state.spheres.forEach { sphere ->
                            Pill(sphere, account.sphere == sphere) {
                                vm.updateIntegrationSphere(account.id, sphere) {
                                    vm.loadIntegrations { integrations = it }
                                }
                            }
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))
                }
                if (integrations?.accounts?.isEmpty() == true) Text("No integrations connected.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            SurfaceCard {
                SectionTitle("Slack digest")
                digest?.digest?.let {
                    Text(it.date, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Text(it.content, maxLines = 8, overflow = TextOverflow.Ellipsis)
                } ?: Text(digest?.lastError ?: "No Slack digest yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                Row {
                    Button(onClick = { vm.refreshSlackDigest(force = true) }, shape = CircleShape) { Text("Refresh") }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { vm.scanSuggestions() }, shape = CircleShape) { Text("Scan Gmail") }
                }
            }
        }
        item {
            TextButton(onClick = { vm.logout() }) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun FocusBottomBar(current: Screen, suggestionCount: Int, onSelect: (Screen) -> Unit) {
    val items = listOf(Screen.Roadmap, Screen.Todo, Screen.Calendar, Screen.Suggestions, Screen.Settings)
    Surface(color = Color(0xFF17131D), shadowElevation = 10.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(62.dp)
                .padding(horizontal = 4.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEach { item ->
                val selected = current == item
                Column(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(16.dp))
                        .clickable { onSelect(item) }
                        .padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier
                            .width(30.dp)
                            .height(4.dp)
                            .clip(CircleShape)
                            .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent),
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (item == Screen.Suggestions && suggestionCount > 0) "Inbox $suggestionCount" else item.navLabel,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun SurfaceCard(
    modifier: Modifier = Modifier,
    contentPadding: androidx.compose.ui.unit.Dp = 12.dp,
    cornerRadius: androidx.compose.ui.unit.Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier.fillMaxWidth(),
        shape = RoundedCornerShape(cornerRadius),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.9f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(contentPadding), content = content)
    }
}

@Composable
private fun Pill(text: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .height(30.dp)
            .widthIn(min = 46.dp)
            .clip(CircleShape)
            .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
            .border(1.dp, if (selected) Color.Transparent else MaterialTheme.colorScheme.outline, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        )
    }
}

@Composable
private fun StatusPill(online: Boolean) {
    val color = if (online) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error
    Row(
        Modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.45f), CircleShape)
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(5.dp))
        Text(if (online) "online" else "offline", color = color, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun MetricPill(text: String, accent: Color = MaterialTheme.colorScheme.primary) {
    Text(
        text,
        color = accent,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier
            .clip(CircleShape)
            .background(accent.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 5.dp),
    )
}

@Composable
private fun PriorityPill(priority: String) {
    val color = priorityColor(priority)
    Text(
        priorityLabel(priority),
        color = color,
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.45f), CircleShape)
            .padding(horizontal = 9.dp, vertical = 6.dp),
    )
}

@Composable
private fun TaskCheck(checked: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(22.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (checked) MaterialTheme.colorScheme.secondary else Color.Transparent)
            .border(2.dp, if (checked) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) Text("✓", color = MaterialTheme.colorScheme.background, fontWeight = FontWeight.Black)
    }
}

@Composable
private fun LogoMark(size: androidx.compose.ui.unit.Dp = 48.dp) {
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(size / 3))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f))
            .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.45f), RoundedCornerShape(size / 3)),
        contentAlignment = Alignment.Center,
    ) {
        Text("F", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Black)
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun EmptyState(text: String) {
    SurfaceCard {
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun priorityColor(priority: String): Color = when (priority) {
    "P1" -> Color(0xFFFF7A70)
    "P2" -> Color(0xFFFFC86B)
    "P3" -> Color(0xFF9AA0A6)
    else -> Color(0xFF9AA0A6)
}

private fun taskMeta(task: TaskDto): String =
    listOfNotNull(
        task.sphere,
        if (task.subtaskCount > 0) "${task.subtaskDone}/${task.subtaskCount}" else null,
        task.dueAt?.let { "due ${formatDate(it)}" },
        if (task.enrichedAt == null && task.status != "done") "classifying..." else null,
    ).joinToString(" · ")

private fun priorityLabel(priority: String): String = when (priority) {
    "P1" -> "High"
    "P2" -> "Medium"
    "P3" -> "Low"
    else -> priority
}

private fun formatDate(value: String): String =
    runCatching {
        DateTimeFormatter.ofPattern("dd MMM HH:mm")
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(value))
    }.getOrDefault(value.take(10))
