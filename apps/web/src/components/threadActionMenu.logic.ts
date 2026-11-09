import { t } from "~/i18n";
import type { ContextMenuItem, PublicationStatus } from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";

export type ThreadActionMenuId =
  | "find"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "share-guest"
  | "publish"
  | `publish:${PublicationStatus}`
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(options: {
  readonly hasPath: boolean;
  readonly hasBranch: boolean;
  readonly hasProject: boolean;
}): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: t("Copy", undefined, "threadMenu"),
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath
          ? [
              {
                id: "copy-path" as const,
                label: t("Path", undefined, "threadMenu"),
                icon: "folder",
              },
            ]
          : []),
        ...(options.hasBranch
          ? [
              {
                id: "copy-branch" as const,
                label: t("Branch", undefined, "threadMenu"),
                icon: "git-branch",
              },
            ]
          : []),
      ],
    },
    ...(options.hasProject
      ? [
          {
            id: "project-settings" as const,
            label: t("Project settings", undefined, "threadMenu"),
            icon: "settings",
          },
        ]
      : []),
    {
      id: "discard",
      label: t("Discard draft", undefined, "threadMenu"),
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
  /** Publication uses the access-write grant, independently of thread operation access. */
  readonly canPublish?: boolean;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
  readonly publicationStatus?: PublicationStatus;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "share-guest",
    "publish",
    "publish:unpublished",
    "publish:read-only",
    "publish:summary",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [
          {
            id: "find" as const,
            label: t("Find in thread", undefined, "threadMenu"),
            icon: "text-search",
          },
        ]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: t("New thread on {branch}", { branch: state.branch }, "threadMenu"),
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? {
                id: "unpin" as const,
                label: t("Unpin thread", undefined, "threadMenu"),
                icon: "pin-off",
              }
            : { id: "pin" as const, label: t("Pin thread", undefined, "threadMenu"), icon: "pin" },
        ]
      : []),
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? {
                id: "unsettle" as const,
                label: t("Un-settle thread", undefined, "threadMenu"),
                icon: "circle-check",
              }
            : {
                id: "settle" as const,
                label: t("Settle thread", undefined, "threadMenu"),
                icon: "circle-check",
              },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? {
                id: "unsnooze" as const,
                label: t("Wake thread", undefined, "threadMenu"),
                icon: "clock",
              }
            : {
                id: "snooze" as const,
                label: t("Snooze", undefined, "threadMenu"),
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: t("Custom…", undefined, "threadMenu"),
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    {
      id: "rename",
      label: t("Rename thread", undefined, "threadMenu"),
      icon: "pencil",
      separatorBefore: true,
    },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle
              ? t("Regenerating…", undefined, "threadMenu")
              : t("Regenerate title", undefined, "threadMenu"),
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: t("Mark unread", undefined, "threadMenu"), icon: "mail-open" },
    ...(state.canShareWithGuest
      ? [
          {
            id: "share-guest" as const,
            label: t("Share with guest", undefined, "threadMenu"),
            icon: "user-plus",
          },
        ]
      : []),
    ...(state.canPublish && state.publicationStatus
      ? [
          {
            id: "publish" as const,
            label: t("Team publication", undefined, "threadMenu"),
            icon: "users",
            children: [
              {
                id: "publish:unpublished" as const,
                label: t("Unpublished", undefined, "threadMenu"),
                checked: state.publicationStatus === "unpublished",
              },
              {
                id: "publish:read-only" as const,
                label: t("Read-only", undefined, "threadMenu"),
                checked: state.publicationStatus === "read-only",
              },
              {
                id: "publish:summary" as const,
                label: t("Summary only", undefined, "threadMenu"),
                checked: state.publicationStatus === "summary",
              },
            ],
          },
        ]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? t("Show all projects", undefined, "threadMenu")
              : t("Filter by {project}", { project: state.projectFilter.label }, "threadMenu"),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: t("Turn into project", undefined, "threadMenu"),
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: t("Auto-settle behavior", undefined, "threadMenu"),
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: t("Enabled", undefined, "threadMenu"),
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: t("Disabled", undefined, "threadMenu"),
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    {
      id: "copy",
      label: t("Copy", undefined, "threadMenu"),
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: t("Path", undefined, "threadMenu"), icon: "folder" },
        ...(state.branch
          ? [
              {
                id: "copy-branch" as const,
                label: t("Branch", undefined, "threadMenu"),
                icon: "git-branch",
              },
            ]
          : []),
        { id: "copy-thread", label: t("Thread", undefined, "threadMenu"), icon: "message-square" },
        { id: "copy-thread-id", label: t("Thread ID", undefined, "threadMenu"), icon: "hash" },
      ],
    },
    {
      id: "project-settings",
      label: t("Project settings", undefined, "threadMenu"),
      icon: "settings",
    },
    {
      id: "archive",
      label: t("Archive thread", undefined, "threadMenu"),
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: t("Delete", undefined, "threadMenu"),
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}
