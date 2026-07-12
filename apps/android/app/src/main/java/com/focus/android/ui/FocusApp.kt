@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.focus.android.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.animateContentSize
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.focus.android.data.AppState
import com.focus.android.data.AssistantMessageDto
import com.focus.android.data.ContextItemDto
import com.focus.android.data.FocusRepository
import com.focus.android.data.IntegrationListResponse
import com.focus.android.data.SubtaskDto
import com.focus.android.data.SuggestionDto
import com.focus.android.data.TaskDto
import com.focus.android.data.UpdateTaskRequest
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private enum class Screen(val title: String, val navLabel: String, val navIcon: String) {
    Roadmap("Today", "Today", "◉"),
    Todo("Tasks", "Tasks", "✓"),
    Completed("Completed", "Done", "✓"),
    Calendar("Calendar", "Calendar", "◇"),
    Suggestions("Suggestions", "Inbox", "✦"),
    Intelligence("Memory", "Memory", "◎"),
    Settings("Settings", "Settings", "⌁"),
}

private enum class EntryPanel { None, NewTask, Assistant }

private val FocusColors = darkColorScheme(
    primary = Color(0xFFAFC6FF),
    onPrimary = Color(0xFF10234D),
    secondary = Color(0xFF72E0C0),
    tertiary = Color(0xFFFFCB77),
    background = Color(0xFF080D18),
    surface = Color(0xFF101827),
    surfaceVariant = Color(0xFF182235),
    onSurface = Color(0xFFF3F6FF),
    onSurfaceVariant = Color(0xFFAEB9CD),
    outline = Color(0xFF526079),
    error = Color(0xFFFF8D8D),
)

private val FocusTypography = androidx.compose.material3.Typography(
    displaySmall = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 40.sp, lineHeight = 44.sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 30.sp, lineHeight = 34.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
    labelMedium = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium, fontSize = 12.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium, fontSize = 10.sp),
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

    MaterialTheme(colorScheme = FocusColors, typography = FocusTypography) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            if (!state.loggedIn) {
                LoginScreen(state, error, vm::login, vm::register)
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
    onLogin: (String, String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
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
                    onLogin(username, password, apiUrl)
                },
                shape = CircleShape,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text("Sign in", fontWeight = FontWeight.Bold) }
            TextButton(
                onClick = {
                    onRegister(username, password, apiUrl)
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
                if (screen in listOf(Screen.Roadmap, Screen.Todo, Screen.Completed, Screen.Intelligence)) {
                    SectionTabs(screen) {
                        screen = it
                        if (it == Screen.Intelligence) vm.loadMemory()
                    }
                }
                AnimatedContent(
                    targetState = screen,
                    modifier = Modifier.weight(1f),
                    transitionSpec = {
                        (fadeIn(tween(220)) + slideInHorizontally(tween(260)) { it / 12 }) togetherWith
                            (fadeOut(tween(140)) + slideOutHorizontally(tween(200)) { -it / 16 })
                    },
                    label = "screen",
                ) { activeScreen ->
                    when (activeScreen) {
                        Screen.Roadmap, Screen.Todo, Screen.Completed -> TaskBoard(state, activeScreen, vm)
                        Screen.Calendar -> CalendarAgenda(state.tasks, vm)
                        Screen.Suggestions -> SuggestionsScreen(vm)
                        Screen.Intelligence -> IntelligenceScreen(vm)
                        Screen.Settings -> SettingsScreen(state, vm)
                    }
                }
            }
        }
    }
}

@Composable
private fun FocusHeader(state: AppState, screen: Screen) {
    Column(Modifier.padding(start = 18.dp, top = 14.dp, end = 18.dp, bottom = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    greeting(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelMedium,
                )
                Text(screen.title, style = MaterialTheme.typography.headlineMedium)
            }
            StatusPill(state.online)
        }
        if (screen == Screen.Roadmap) {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricPill("${state.tasks.count { it.status != "done" && it.status != "archived" }} active")
                MetricPill("${state.tasks.count { it.status == "done" }} complete", accent = MaterialTheme.colorScheme.secondary)
                if (state.pendingCaptures > 0) MetricPill("${state.pendingCaptures} queued", accent = MaterialTheme.colorScheme.tertiary)
            }
        }
    }
}

@Composable
private fun SectionTabs(current: Screen, onSelect: (Screen) -> Unit) {
    val tabs = listOf(Screen.Completed, Screen.Intelligence)
    Row(
        Modifier
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 5.dp),
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
    var assistantDraft by rememberSaveable { mutableStateOf("") }
    var sphere by rememberSaveable { mutableStateOf<String?>(null) }
    var entryPanel by rememberSaveable { mutableStateOf(EntryPanel.None) }
    val assistantMessages by vm.assistantMessages.collectAsState()
    val assistantBusy by vm.assistantBusy.collectAsState()
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
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (screen == Screen.Roadmap) {
            item {
                EntryActions(
                    active = entryPanel,
                    onNewTask = { entryPanel = if (entryPanel == EntryPanel.NewTask) EntryPanel.None else EntryPanel.NewTask },
                    onAssistant = { entryPanel = if (entryPanel == EntryPanel.Assistant) EntryPanel.None else EntryPanel.Assistant },
                )
            }
            when (entryPanel) {
                EntryPanel.NewTask -> item {
                    CaptureCard(
                        draft = draft,
                        onDraft = { draft = it },
                        onClose = { entryPanel = EntryPanel.None },
                        onAdd = {
                            if (draft.isNotBlank()) {
                                vm.capture(draft.trim())
                                draft = ""
                                entryPanel = EntryPanel.None
                            }
                        },
                    )
                }
                EntryPanel.Assistant -> item {
                    AssistantPanel(
                        draft = assistantDraft,
                        onDraft = { assistantDraft = it },
                        messages = assistantMessages,
                        busy = assistantBusy,
                        onClose = { entryPanel = EntryPanel.None },
                        onSend = {
                            if (assistantDraft.isNotBlank()) {
                                vm.sendAssistant(assistantDraft)
                                assistantDraft = ""
                            }
                        },
                    )
                }
                EntryPanel.None -> Unit
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
private fun EntryActions(active: EntryPanel, onNewTask: () -> Unit, onAssistant: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(
            onClick = onNewTask,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(18.dp),
        ) { Text(if (active == EntryPanel.NewTask) "Close" else "+ New task") }
        Button(
            onClick = onAssistant,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(18.dp),
        ) { Text(if (active == EntryPanel.Assistant) "Close assistant" else "✦ Ask Focus") }
    }
}

@Composable
private fun CaptureCard(draft: String, onDraft: (String) -> Unit, onClose: () -> Unit, onAdd: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF1D3154), Color(0xFF222B48), Color(0xFF242340)),
                ),
            )
            .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.18f), RoundedCornerShape(24.dp))
            .animateContentSize()
            .padding(16.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("NEW TASK", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onClose) { Text("Cancel") }
            }
            Text("What do you need to do?", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = onDraft,
                    placeholder = { Text("Call Marta tomorrow at 10") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                )
                Spacer(Modifier.width(10.dp))
                Button(
                    onClick = onAdd,
                    enabled = draft.isNotBlank(),
                    shape = CircleShape,
                    modifier = Modifier.size(52.dp),
                    contentPadding = PaddingValues(0.dp),
                ) { Text("↑", fontSize = 24.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

@Composable
private fun AssistantPanel(
    draft: String,
    onDraft: (String) -> Unit,
    messages: List<AssistantMessageDto>,
    busy: Boolean,
    onClose: () -> Unit,
    onSend: () -> Unit,
) {
    val voice = rememberVoiceCapture(onDraft)
    val listening = voice.stage == VoiceStage.Listening
    val pulse = rememberInfiniteTransition(label = "assistantVoicePulse")
    val micScale by pulse.animateFloat(
        initialValue = 1f,
        targetValue = if (listening) 1.08f else 1f,
        animationSpec = infiniteRepeatable(tween(650), RepeatMode.Reverse),
        label = "assistantMicScale",
    )
    SurfaceCard(contentPadding = 14.dp, cornerRadius = 22.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("FOCUS ASSISTANT", color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.labelSmall)
                Text("Change several tasks at once", style = MaterialTheme.typography.titleMedium)
            }
            TextButton(onClick = onClose) { Text("Close") }
        }
        Text(
            "Tell me what changed. I can create, reprioritise, complete or remove tasks, then confirm every action.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
        if (messages.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            messages.takeLast(6).forEach { message ->
                AssistantBubble(message)
                Spacer(Modifier.height(7.dp))
            }
        }
        if (busy) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text("Focus is updating your tasks…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
        }
        if (voice.message != null || listening || voice.stage == VoiceStage.Processing) {
            Text(
                voice.message ?: if (listening) "Listening… tap stop when finished." else "Transcribing…",
                color = if (voice.stage == VoiceStage.Error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,
                style = MaterialTheme.typography.labelMedium,
            )
            Spacer(Modifier.height(6.dp))
        }
        Row(verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = draft,
                onValueChange = onDraft,
                placeholder = { Text("What changed?") },
                modifier = Modifier.weight(1f),
                minLines = 2,
                maxLines = 5,
                shape = RoundedCornerShape(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier
                        .scale(micScale)
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(if (listening) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.secondary.copy(alpha = 0.14f))
                        .border(1.dp, MaterialTheme.colorScheme.secondary.copy(alpha = 0.55f), CircleShape)
                        .semantics { contentDescription = if (listening) "Stop assistant voice input" else "Start assistant voice input" }
                        .clickable { if (listening) voice.stop() else voice.start() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (listening) "■" else "MIC", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(6.dp))
                Button(
                    onClick = onSend,
                    enabled = draft.isNotBlank() && !busy,
                    modifier = Modifier.size(46.dp),
                    shape = CircleShape,
                    contentPadding = PaddingValues(0.dp),
                ) { Text("↑", fontSize = 21.sp) }
            }
        }
    }
}

@Composable
private fun AssistantBubble(message: AssistantMessageDto) {
    val assistant = message.role == "assistant"
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (assistant) MaterialTheme.colorScheme.secondary.copy(alpha = 0.10f)
                else MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
            )
            .padding(11.dp),
    ) {
        Column {
            Text(if (assistant) "Focus" else "You", color = if (assistant) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.height(3.dp))
            Text(message.content, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun TaskCard(task: TaskDto, vm: FocusViewModel) {
    val priorityColor = priorityColor(task.priority)
    Card(
        onClick = { vm.selectTask(task) },
        modifier = Modifier.animateContentSize(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.78f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .width(3.dp)
                    .height(48.dp)
                    .clip(CircleShape)
                    .background(priorityColor),
            )
            Spacer(Modifier.width(12.dp))
            TaskCheck(
                checked = task.status == "done",
                onClick = {
                    vm.updateTask(task.id, UpdateTaskRequest(status = if (task.status == "done") "inbox" else "done"))
                },
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    task.title,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleSmall,
                )
                Spacer(Modifier.height(4.dp))
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
                TextButton(onClick = onClose, contentPadding = PaddingValues(0.dp)) { Text("← Back") }
                Spacer(Modifier.weight(1f))
                PriorityPill(task.priority)
            }
            Spacer(Modifier.height(8.dp))
            Text("TASK", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall)
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                modifier = Modifier.fillMaxWidth(),
                textStyle = MaterialTheme.typography.titleLarge,
                minLines = 2,
                maxLines = 5,
                shape = RoundedCornerShape(18.dp),
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { vm.updateTask(task.id, UpdateTaskRequest(title = title)) },
                    enabled = title.isNotBlank() && title != task.title,
                    shape = CircleShape,
                ) {
                    Text("Save changes")
                }
                Spacer(Modifier.width(8.dp))
                TextButton(
                    onClick = {
                        vm.updateTask(
                            task.id,
                            UpdateTaskRequest(status = if (task.status == "done") "inbox" else "done"),
                        )
                    },
                ) { Text(if (task.status == "done") "Reopen" else "Mark complete") }
            }
            Text(taskMeta(task), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
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
    var aiKey by rememberSaveable { mutableStateOf("") }
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
                SectionTitle("Focus assistant")
                Text(
                    if (state.profile?.hasAiKey == true) "Gemini is connected." else "Add a Gemini API key to use Ask Focus.",
                    color = if (state.profile?.hasAiKey == true) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = aiKey,
                    onValueChange = { aiKey = it },
                    label = { Text("Gemini API key") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        vm.setAiKey(aiKey.trim())
                        aiKey = ""
                    },
                    enabled = aiKey.isNotBlank(),
                    shape = CircleShape,
                ) { Text("Connect assistant") }
                Text(
                    "The key is encrypted by your Focus server and is never returned to the app.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
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
    Surface(color = Color(0xFF0E1523), shadowElevation = 16.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(70.dp)
                .padding(horizontal = 8.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEach { item ->
                val selected = current == item
                val itemBackground by animateColorAsState(
                    if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.13f) else Color.Transparent,
                    animationSpec = tween(180),
                    label = "navBackground",
                )
                Column(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(18.dp))
                        .background(itemBackground)
                        .clickable { onSelect(item) }
                        .padding(vertical = 5.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        item.navIcon,
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(1.dp))
                    Text(
                        if (item == Screen.Suggestions && suggestionCount > 0) "Inbox $suggestionCount" else item.navLabel,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
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
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.74f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(contentPadding), content = content)
    }
}

@Composable
private fun Pill(text: String, selected: Boolean, onClick: () -> Unit) {
    val background by animateColorAsState(
        if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
        animationSpec = tween(180),
        label = "pillBackground",
    )
    val border by animateColorAsState(
        if (selected) Color.Transparent else MaterialTheme.colorScheme.outline.copy(alpha = 0.72f),
        animationSpec = tween(180),
        label = "pillBorder",
    )
    Box(
        Modifier
            .height(34.dp)
            .widthIn(min = 46.dp)
            .clip(CircleShape)
            .background(background)
            .border(1.dp, border, CircleShape)
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
    "P1" -> Color(0xFFFF8D8D)
    "P2" -> Color(0xFFFFCB77)
    "P3" -> Color(0xFF91A0B8)
    else -> Color(0xFF91A0B8)
}

private fun greeting(): String = when (LocalTime.now().hour) {
    in 5..11 -> "GOOD MORNING · FOCUS"
    in 12..17 -> "GOOD AFTERNOON · FOCUS"
    else -> "GOOD EVENING · FOCUS"
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
