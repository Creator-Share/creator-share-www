import React from "react";
import { Button, Input, Textarea } from "@chakra-ui/react";
import { Activity } from "@/types/admin.types";

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
}

export const CreateActivityModal: React.FC<CreateModalProps> = ({
  open,
  onClose,
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  onCreate,
  creating,
  error,
}) =>
  open ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          minWidth: 350,
          maxWidth: "90vw",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}>
          Create Activity
        </div>
        <Input
          placeholder="Title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          style={{ marginBottom: 12 }}
          p={2}
          className="border border-stone-600"
        />
        <Textarea
          placeholder="Description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          style={{ marginBottom: 12 }}
          p={2}
          className="border border-stone-600"
        />
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button onClick={onClose} style={{ marginRight: 12 }} disabled={creating}>
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={onCreate}
            disabled={!title || !description}
          >
            Create
          </Button>
        </div>
      </div>
    </div>
  ) : null;

interface EditModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}

export const EditActivityModal: React.FC<EditModalProps> = ({
  open,
  onClose,
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  onSave,
  saving,
  error,
}) =>
  open ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          minWidth: 350,
          maxWidth: "90vw",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}>
          Edit Activity
        </div>
        <Input
          placeholder="Title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          style={{ marginBottom: 12 }}
          p={2}
          className="border border-stone-600"
        />
        <Textarea
          placeholder="Description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          style={{ marginBottom: 12 }}
          p={2}
          className="border border-stone-600"
        />
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={onSave}
            disabled={!title || !description}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  ) : null;

interface DeleteModalProps {
  open: boolean;
  onClose: () => void;
  activity: Activity | null;
  onDelete: () => void;
  deleting: boolean;
  error: string | null;
}

export const DeleteActivityModal: React.FC<DeleteModalProps> = ({
  open,
  onClose,
  activity,
  onDelete,
  deleting,
  error,
}) =>
  open && activity ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          minWidth: 350,
          maxWidth: "90vw",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}>
          Delete Activity
        </div>
        <div style={{ marginBottom: 16 }}>
          Are you sure you want to delete the activity <b>{activity.title}</b>?
        </div>
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            colorScheme="red"
            onClick={onDelete}
            disabled={deleting}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  ) : null;
