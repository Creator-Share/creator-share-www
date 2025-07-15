import React from "react";
import { Text, Flex } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog";

interface DeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  itemCount: number;
}

const DeleteDialog: React.FC<DeleteDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemCount,
}) => {
  return (
    <DialogRoot open={isOpen}>
      <DialogContent>
        <DialogHeader>
          <Text className="text-xl font-semibold">Confirm Deletion</Text>
          <DialogCloseTrigger onClick={onClose} />
        </DialogHeader>
        <DialogBody>
          <Text>
            Are you sure you want to delete {itemCount} selected street involved? This action cannot be undone.
          </Text>
          <Flex gap={3} mt={4}>
            <Button
              onClick={onClose}
              className="bg-gray-500 text-white p-4"
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              className="bg-red-500 text-white p-4"
            >
              Delete
            </Button>
          </Flex>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
};

export default DeleteDialog;
