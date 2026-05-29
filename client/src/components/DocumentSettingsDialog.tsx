import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import React, { useEffect, useRef, useState } from 'react';

export interface DocumentSettings {
  documentClass: string;
  paperSize: string;
  margins: string;
  language: string;
  fontsize: string;
  encoding: string;
}

interface DocumentSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (settings: DocumentSettings) => void;
  currentSettings?: DocumentSettings;
}

const DEFAULT_SETTINGS: DocumentSettings = {
  documentClass: 'article',
  paperSize: 'a4paper',
  margins: 'default',
  language: 'english',
  fontsize: '11pt',
  encoding: 'utf8',
};

const SelectField: React.FC<{
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}> = ({ label, id, value, onChange, options }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
  };

  const handleSelectOption = (optValue: string) => {
    setInputValue(optValue);
    onChange(optValue);
    setIsOpen(false);
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onClick={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIsOpen(true);
            }
          }}
          placeholder="Type or choose..."
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isOpen && options.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-input bg-background shadow-md">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelectOption(opt.value)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none first:rounded-t-md last:rounded-b-md"
              >
                {opt.label}
                {opt.value !== opt.label && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({opt.value})
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const DocumentSettingsDialog: React.FC<DocumentSettingsDialogProps> = ({
  isOpen,
  onClose,
  onApply,
  currentSettings = DEFAULT_SETTINGS,
}) => {
  const [settings, setSettings] = useState<DocumentSettings>(currentSettings);

  useEffect(() => {
    setSettings(currentSettings);
  }, [currentSettings, isOpen]);

  const handleApply = () => {
    onApply(settings);
    onClose();
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Document Settings</DialogTitle>
          <DialogDescription>
            Configure global LaTeX document style settings
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Document Class */}
          <SelectField
            label="Document Class"
            id="docclass"
            value={settings.documentClass}
            onChange={(value) =>
              setSettings({ ...settings, documentClass: value })
            }
            options={[
              { value: 'article', label: 'Article' },
              { value: 'report', label: 'Report' },
              { value: 'book', label: 'Book' },
              { value: 'letter', label: 'Letter' },
              { value: 'beamer', label: 'Beamer (Presentation)' },
            ]}
          />

          {/* Paper Size */}
          <SelectField
            label="Paper Size"
            id="papersize"
            value={settings.paperSize}
            onChange={(value) => setSettings({ ...settings, paperSize: value })}
            options={[
              { value: 'a4paper', label: 'A4' },
              { value: 'a5paper', label: 'A5' },
              { value: 'b5paper', label: 'B5' },
              { value: 'letterpaper', label: 'Letter' },
              { value: 'legalpaper', label: 'Legal' },
            ]}
          />

          {/* Font Size */}
          <SelectField
            label="Font Size"
            id="fontsize"
            value={settings.fontsize}
            onChange={(value) => setSettings({ ...settings, fontsize: value })}
            options={[
              { value: '10pt', label: '10pt' },
              { value: '11pt', label: '11pt' },
              { value: '12pt', label: '12pt' },
            ]}
          />

          {/* Language */}
          <SelectField
            label="Language"
            id="language"
            value={settings.language}
            onChange={(value) => setSettings({ ...settings, language: value })}
            options={[
              { value: 'english', label: 'English' },
              { value: 'ngerman', label: 'German' },
              { value: 'french', label: 'French' },
              { value: 'spanish', label: 'Spanish' },
              { value: 'italian', label: 'Italian' },
            ]}
          />

          {/* Margins */}
          <SelectField
            label="Margins"
            id="margins"
            value={settings.margins}
            onChange={(value) => setSettings({ ...settings, margins: value })}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'narrow', label: 'Narrow (2cm)' },
              { value: 'wide', label: 'Wide (3cm)' },
            ]}
          />

          {/* Encoding */}
          <SelectField
            label="Encoding"
            id="encoding"
            value={settings.encoding}
            onChange={(value) => setSettings({ ...settings, encoding: value })}
            options={[
              { value: 'utf8', label: 'UTF-8' },
              { value: 'utf8x', label: 'UTF-8 (Extended)' },
              { value: 'latin1', label: 'Latin-1' },
            ]}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-4">
          <Button variant="outline" onClick={handleReset}>
            Reset
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
