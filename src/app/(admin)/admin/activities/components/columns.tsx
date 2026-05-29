"use client"

import { ColumnDef } from "@tanstack/react-table"
import Image from "next/image"
import { Activity } from "@/types/admin.types"

import React from "react"
import { Button } from "@chakra-ui/react"

const PHOTO_THUMB_PX = 24
const MAX_VISIBLE_PHOTOS = 4

function ActivityMediaCell({ activity }: { activity: Activity }) {
  const images = activity.images_url ?? []
  const videos = activity.videos_url ?? []

  /** Row uses text-center; flex rows still align start unless we center the group. */
  const wrap = (node: React.ReactNode) => (
    <div className="flex w-full min-h-[1.5rem] items-center justify-center">
      {node}
    </div>
  )

  if (images.length > 0) {
    const visible = images.slice(0, MAX_VISIBLE_PHOTOS)
    const extra = images.length - visible.length
    return wrap(
      <div className="flex items-center justify-center gap-0.5">
        {visible.map((src, i) => (
          <div
            key={`${activity.id}-img-${i}`}
            className="relative h-6 w-6 shrink-0 overflow-hidden rounded"
          >
            <Image
              src={src}
              alt={`${activity.title} photo ${i + 1}`}
              width={PHOTO_THUMB_PX}
              height={PHOTO_THUMB_PX}
              className="object-cover"
            />
          </div>
        ))}
        {extra > 0 && (
          <span className="text-xs text-gray-500 tabular-nums">+{extra}</span>
        )}
      </div>,
    )
  }

  if (videos.length > 0) {
    return wrap(
      <span className="text-xs text-gray-500" title="Video attached">
        Video
      </span>,
    )
  }

  return wrap(<span className="text-gray-400">—</span>)
}

export type ActivityActionHandlers = {
  onEdit: (activity: Activity) => void
  onDelete: (activity: Activity) => void
  onTogglePublic?: (activity: Activity) => void
}

export function getActivityColumns(
  handlers: ActivityActionHandlers,
  showDeleteButton: boolean = true,
): ColumnDef<unknown, unknown>[] {
  return [
    {
      accessorKey: "is_public",
      header: () => <span>Visibility</span>,
      cell: ({ row }) => {
        const activity = row.original as Activity
        const isPublic = activity.is_public ?? false
        return (
          <button
            type="button"
            onClick={() => handlers.onTogglePublic?.(activity)}
            title="Click to toggle visibility"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: "0.7rem",
              fontWeight: 600,
              cursor: handlers.onTogglePublic ? "pointer" : "default",
              border: "none",
              background: isPublic ? "#dcfce7" : "#f3f4f6",
              color: isPublic ? "#166534" : "#6b7280",
              transition: "opacity 0.15s",
            }}
          >
            <span style={{ fontSize: "0.6rem" }}>{isPublic ? "🟢" : "🔒"}</span>
            {isPublic ? "PUBLIC" : "PRIVATE"}
          </button>
        )
      },
      meta: { excludeFromClick: true },
    },
    {
      id: "photos",
      accessorKey: "images_url",
      header: () => <span>Photos</span>,
      cell: ({ row }) => (
        <ActivityMediaCell activity={row.original as Activity} />
      ),
    },
    {
      accessorKey: "title",
      header: () => <span>Title</span>,
      cell: ({ row }) => (row.original as Activity).title,
    },
    {
      accessorKey: "description",
      header: () => <span>Description</span>,
      cell: ({ row }) => {
        const text = (row.original as Activity).description ?? ""
        return (
          <div className="line-clamp-2 min-w-0 whitespace-normal break-words text-left">
            {text}
          </div>
        )
      },
      meta: {
        thClassName: "w-[50%] max-w-[50%] text-left",
        tdClassName:
          "w-[50%] max-w-[50%] min-w-0 align-top overflow-hidden",
      },
    },
    {
      accessorKey: "created_at",
      header: () => <span>Created At</span>,
      cell: ({ row }) =>
        new Date((row.original as Activity).created_at).toLocaleString(),
    },
    {
      id: "actions",
      header: () => <span>Actions</span>,
      cell: ({ row }) => (
        <div
          style={{ display: "flex", gap: 8 }}
          className="text-center justify-center"
        >
          <Button
            size="xs"
            colorScheme="yellow"
            onClick={() => handlers.onEdit(row.original as Activity)}
          >
            Edit
          </Button>
          {showDeleteButton && (
            <Button
              size="xs"
              colorScheme="red"
              onClick={() => handlers.onDelete(row.original as Activity)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
      meta: { excludeFromClick: true },
    },
  ]
}
