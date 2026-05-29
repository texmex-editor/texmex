import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DetectedFormula } from '@/snippets/formula/formulaUtils';
import { PencilLine } from 'lucide-react';
import 'mathlive';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../../node_modules/mathlive/mathlive-fonts.css';
import '../../node_modules/mathlive/mathlive-static.css';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          ref?: React.Ref<HTMLElement>;
          value?: string;
          smartMode?: string;
          mathVirtualKeyboardPolicy?: string;
          readonly?: string | boolean;
        },
        HTMLElement
      >;
    }
  }
}

interface FormulaEditDialogProps {
  open: boolean;
  formula: DetectedFormula | null;
  onOpenChange: (open: boolean) => void;
  onSave: (nextBody: string) => void;
}

export const FormulaEditDialog: React.FC<FormulaEditDialogProps> = ({
  open,
  formula,
  onOpenChange,
  onSave,
}) => {
  const [draft, setDraft] = useState('');
  const editableFieldRef = useRef<HTMLElement | null>(null);
  const blockImplicitClose = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
    },
    [],
  );

  useEffect(() => {
    if (!open || !formula) {
      setDraft('');
      return;
    }

    setDraft(formula.body);
  }, [formula, open]);

  useEffect(() => {
    if (!open || !formula || !editableFieldRef.current) {
      return;
    }

    // Set initial value
    (editableFieldRef.current as any).value = formula.body;

    const handleInput = () => {
      const newValue = (editableFieldRef.current as any).value || '';
      setDraft(newValue);
    };

    const handleChange = () => {
      const newValue = (editableFieldRef.current as any).value || '';
      setDraft(newValue);
    };

    editableFieldRef.current.addEventListener('input', handleInput);
    editableFieldRef.current.addEventListener('change', handleChange);

    // Focus after a small delay
    setTimeout(() => {
      (editableFieldRef.current as any)?.focus?.();
    }, 50);

    return () => {
      if (editableFieldRef.current) {
        editableFieldRef.current.removeEventListener('input', handleInput);
        editableFieldRef.current.removeEventListener('change', handleChange);
      }
    };
  }, [open, formula]);

  useEffect(() => {
    if (editableFieldRef.current) {
      const currentValue = (editableFieldRef.current as any).value || '';
      if (currentValue !== draft) {
        (editableFieldRef.current as any).value = draft;
      }
    }
  }, [draft]);

  const handleApplyChanges = useCallback(() => {
    const currentValue = (editableFieldRef.current as any)?.value;
    onSave(typeof currentValue === 'string' ? currentValue : draft);
    onOpenChange(false);
  }, [draft, onOpenChange, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-5xl overflow-auto sm:max-w-5xl"
        onInteractOutside={blockImplicitClose}
        onPointerDownOutside={blockImplicitClose}
        onEscapeKeyDown={blockImplicitClose}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine className="size-4" />
            Edit formula
          </DialogTitle>
          <DialogDescription>
            Edit your LaTeX formula with the visual equation editor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-6">
          <math-field
            ref={editableFieldRef as any}
            smartMode="true"
            mathVirtualKeyboardPolicy="manual"
            style={{
              width: '100%',
              minHeight: '8rem',
              fontSize: '1.25rem',
              padding: '1rem',
              borderRadius: '0.75rem',
              border: '1px solid hsl(var(--border))',
              background: 'hsl(var(--background))',
              display: 'block',
            }}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApplyChanges}
            disabled={!formula}
          >
            Apply changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
