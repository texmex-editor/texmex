import { Share2 } from 'lucide-react';
import React from 'react';

import { buttonVariants } from '@/components/ui/button-variants';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface ShareDocumentButtonProps {
  docId: string;
  canManageCollaborators?: boolean;
}

export const ShareDocumentButton: React.FC<ShareDocumentButtonProps> = ({
  docId: _docId,
  canManageCollaborators: _canManageCollaborators = false,
}) => {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={buttonVariants({ variant: 'outline', size: 'sm', className: 'gap-2' })}
      >
          <Share2 className="h-4 w-4" />
          Share
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72">
        <h3 className="text-sm font-semibold text-foreground">Sharing</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Only document owners can create and copy invite or anonymous links.
        </p>
      </PopoverContent>
    </Popover>
  );
};
