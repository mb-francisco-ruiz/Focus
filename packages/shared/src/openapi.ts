import { z } from "zod";
import {
  AddContextRequest,
  AddMemoryRecordRequest,
  AuthResponse,
  ContextListResponse,
  CreateSubtaskRequest,
  CreateTaskRequest,
  DeviceInfo,
  IntegrationListResponse,
  LoginRequest,
  MemoryRecordInfo,
  MemoryResponse,
  PreferencesResponse,
  QueuedResponse,
  RegisterRequest,
  RegisterDeviceRequest,
  SpherePreferences,
  SlackChannelsResponse,
  SlackDigestResponse,
  SlackDigestSettingsRequest,
  SlackDigestSettingsResponse,
  UpdateIntegrationRequest,
  UpdateIntegrationResponse,
  UpdateSpheresRequest,
  UpdateSpheresResponse,
  SubtaskListResponse,
  SuggestionListResponse,
  SyncResponse,
  TaskListResponse,
  UserProfile,
  UpdateSubtaskRequest,
  UpdateTaskRequest,
} from "./api.js";
import { ContextItem, Subtask, Suggestion, Task } from "./domain.js";

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

function schema(value: z.ZodType): unknown {
  return z.toJSONSchema(value, { target: "draft-7" });
}

function ref(name: string): unknown {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonBody(name: string): unknown {
  return {
    required: true,
    content: { "application/json": { schema: ref(name) } },
  };
}

function jsonResponse(name: string): unknown {
  return {
    description: "OK",
    content: { "application/json": { schema: ref(name) } },
  };
}

function noContent(): unknown {
  return { description: "No content" };
}

function operation(args: {
  method: HttpMethod;
  path: string;
  summary: string;
  tags: string[];
  request?: string;
  response?: string;
  noContent?: boolean;
  auth?: boolean;
  parameters?: unknown[];
}): [string, HttpMethod, unknown] {
  const responses = args.noContent ? { 204: noContent() } : { 200: jsonResponse(args.response ?? "Task") };
  return [
    args.path,
    args.method,
    {
      summary: args.summary,
      tags: args.tags,
      ...(args.auth === false ? {} : { security: [{ bearerAuth: [] }] }),
      ...(args.parameters ? { parameters: args.parameters } : {}),
      ...(args.request ? { requestBody: jsonBody(args.request) } : {}),
      responses,
    },
  ];
}

function pathParam(name: string): unknown {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  };
}

export function openApiDocument() {
  const ops = [
    operation({
      method: "post",
      path: "/auth/login",
      summary: "Log in",
      tags: ["auth"],
      request: "LoginRequest",
      response: "AuthResponse",
      auth: false,
    }),
    operation({
      method: "post",
      path: "/auth/register",
      summary: "Register an internal account",
      tags: ["auth"],
      request: "RegisterRequest",
      response: "AuthResponse",
      auth: false,
    }),
    operation({
      method: "get",
      path: "/users/me",
      summary: "Get current user profile",
      tags: ["profile"],
      response: "UserProfile",
    }),
    operation({
      method: "put",
      path: "/users/me/spheres",
      summary: "Replace task categories",
      tags: ["profile"],
      request: "UpdateSpheresRequest",
      response: "UpdateSpheresResponse",
    }),
    operation({
      method: "get",
      path: "/tasks",
      summary: "List non-archived tasks",
      tags: ["tasks"],
      response: "TaskListResponse",
    }),
    operation({
      method: "post",
      path: "/tasks",
      summary: "Capture a task",
      tags: ["tasks"],
      request: "CreateTaskRequest",
      response: "Task",
    }),
    operation({
      method: "patch",
      path: "/tasks/{id}",
      summary: "Update a task",
      tags: ["tasks"],
      request: "UpdateTaskRequest",
      response: "Task",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "get",
      path: "/sync",
      summary: "Backfill task changes since a cursor",
      tags: ["sync"],
      response: "SyncResponse",
      parameters: [
        {
          name: "since",
          in: "query",
          required: false,
          schema: { type: "string", format: "date-time" },
        },
      ],
    }),
    operation({
      method: "get",
      path: "/tasks/{id}/context",
      summary: "List task context",
      tags: ["context"],
      response: "ContextListResponse",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "post",
      path: "/tasks/{id}/context",
      summary: "Add text or link context",
      tags: ["context"],
      request: "AddContextRequest",
      response: "ContextItem",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "post",
      path: "/tasks/{id}/attachments",
      summary: "Upload an image attachment",
      tags: ["context"],
      response: "ContextItem",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "get",
      path: "/tasks/{id}/subtasks",
      summary: "List subtasks",
      tags: ["subtasks"],
      response: "SubtaskListResponse",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "post",
      path: "/tasks/{id}/subtasks",
      summary: "Add a subtask",
      tags: ["subtasks"],
      request: "CreateSubtaskRequest",
      response: "Subtask",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "patch",
      path: "/subtasks/{id}",
      summary: "Update a subtask",
      tags: ["subtasks"],
      request: "UpdateSubtaskRequest",
      response: "Subtask",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "delete",
      path: "/subtasks/{id}",
      summary: "Delete a subtask",
      tags: ["subtasks"],
      noContent: true,
      parameters: [pathParam("id")],
    }),
    operation({
      method: "get",
      path: "/suggestions",
      summary: "List pending suggestions",
      tags: ["suggestions"],
      response: "SuggestionListResponse",
    }),
    operation({
      method: "post",
      path: "/suggestions/scan",
      summary: "Queue a manual Gmail suggestion scan",
      tags: ["suggestions"],
      response: "QueuedResponse",
    }),
    operation({
      method: "post",
      path: "/suggestions/{id}/accept",
      summary: "Accept a suggestion",
      tags: ["suggestions"],
      response: "Task",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "post",
      path: "/suggestions/{id}/dismiss",
      summary: "Dismiss a suggestion",
      tags: ["suggestions"],
      noContent: true,
      parameters: [pathParam("id")],
    }),
    operation({
      method: "get",
      path: "/memory",
      summary: "List memory records and behaviour preferences",
      tags: ["memory"],
      response: "MemoryResponse",
    }),
    operation({
      method: "post",
      path: "/memory",
      summary: "Teach Focus a memory record",
      tags: ["memory"],
      request: "AddMemoryRecordRequest",
      response: "MemoryRecordInfo",
    }),
    operation({
      method: "put",
      path: "/memory/preferences",
      summary: "Update behaviour preferences",
      tags: ["memory"],
      request: "SpherePreferences",
      response: "PreferencesResponse",
    }),
    operation({
      method: "delete",
      path: "/memory/{id}",
      summary: "Suppress a memory record",
      tags: ["memory"],
      noContent: true,
      parameters: [pathParam("id")],
    }),
    operation({
      method: "get",
      path: "/integrations",
      summary: "List connected integrations",
      tags: ["integrations"],
      response: "IntegrationListResponse",
    }),
    operation({
      method: "put",
      path: "/integrations/{id}",
      summary: "Link an integration to a category",
      tags: ["integrations"],
      request: "UpdateIntegrationRequest",
      response: "UpdateIntegrationResponse",
      parameters: [pathParam("id")],
    }),
    operation({
      method: "delete",
      path: "/integrations/{id}",
      summary: "Disconnect an integration",
      tags: ["integrations"],
      noContent: true,
      parameters: [pathParam("id")],
    }),
    operation({
      method: "get",
      path: "/slack/digest",
      summary: "Get latest Slack daily digest",
      tags: ["slack"],
      response: "SlackDigestResponse",
    }),
    operation({
      method: "get",
      path: "/slack/channels",
      summary: "List Slack member channels",
      tags: ["slack"],
      response: "SlackChannelsResponse",
    }),
    operation({
      method: "post",
      path: "/slack/digest/refresh",
      summary: "Queue Slack digest generation",
      tags: ["slack"],
      response: "QueuedResponse",
    }),
    operation({
      method: "put",
      path: "/slack/digest/settings",
      summary: "Update Slack digest exclusions",
      tags: ["slack"],
      request: "SlackDigestSettingsRequest",
      response: "SlackDigestSettingsResponse",
    }),
    operation({
      method: "post",
      path: "/devices",
      summary: "Register or update a client device",
      tags: ["devices"],
      request: "RegisterDeviceRequest",
      response: "DeviceInfo",
    }),
    operation({
      method: "delete",
      path: "/devices/{id}",
      summary: "Disable a client device",
      tags: ["devices"],
      noContent: true,
      parameters: [pathParam("id")],
    }),
  ];

  const paths: Record<string, Record<HttpMethod, unknown>> = {};
  for (const [path, method, op] of ops) {
    paths[path] ??= {} as Record<HttpMethod, unknown>;
    paths[path][method] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Focus API",
      version: "0.1.0",
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        AddContextRequest: schema(AddContextRequest),
        AddMemoryRecordRequest: schema(AddMemoryRecordRequest),
        AuthResponse: schema(AuthResponse),
        ContextItem: schema(ContextItem),
        ContextListResponse: schema(ContextListResponse),
        CreateSubtaskRequest: schema(CreateSubtaskRequest),
        CreateTaskRequest: schema(CreateTaskRequest),
        DeviceInfo: schema(DeviceInfo),
        IntegrationListResponse: schema(IntegrationListResponse),
        LoginRequest: schema(LoginRequest),
        MemoryRecordInfo: schema(MemoryRecordInfo),
        MemoryResponse: schema(MemoryResponse),
        PreferencesResponse: schema(PreferencesResponse),
        QueuedResponse: schema(QueuedResponse),
        RegisterRequest: schema(RegisterRequest),
        RegisterDeviceRequest: schema(RegisterDeviceRequest),
        SpherePreferences: schema(SpherePreferences),
        SlackChannelsResponse: schema(SlackChannelsResponse),
        SlackDigestResponse: schema(SlackDigestResponse),
        SlackDigestSettingsRequest: schema(SlackDigestSettingsRequest),
        SlackDigestSettingsResponse: schema(SlackDigestSettingsResponse),
        UpdateIntegrationRequest: schema(UpdateIntegrationRequest),
        UpdateIntegrationResponse: schema(UpdateIntegrationResponse),
        UpdateSpheresRequest: schema(UpdateSpheresRequest),
        UpdateSpheresResponse: schema(UpdateSpheresResponse),
        Subtask: schema(Subtask),
        SubtaskListResponse: schema(SubtaskListResponse),
        Suggestion: schema(Suggestion),
        SuggestionListResponse: schema(SuggestionListResponse),
        SyncResponse: schema(SyncResponse),
        Task: schema(Task),
        TaskListResponse: schema(TaskListResponse),
        UpdateSubtaskRequest: schema(UpdateSubtaskRequest),
        UpdateTaskRequest: schema(UpdateTaskRequest),
        UserProfile: schema(UserProfile),
      },
    },
  };
}
