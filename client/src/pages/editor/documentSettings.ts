import type { DocumentSettings } from '@/components/DocumentSettingsDialog';
import type { EditorSetup } from '@/utils/editor';
import type { MutableRefObject } from 'react';
import { toast } from 'sonner';

export const extractDocumentSettings = (content: string): DocumentSettings => {
  const defaults: DocumentSettings = {
    documentClass: 'article',
    paperSize: 'a4paper',
    margins: 'default',
    language: 'english',
    fontsize: '11pt',
    encoding: 'utf8',
  };

  const docClassMatch = content.match(
    /\\documentclass\[([^\]]*)\]\{([^}]*)\}|\\documentclass\{([^}]*)\}/,
  );
  if (docClassMatch) {
    defaults.documentClass =
      docClassMatch[2] || docClassMatch[3] || defaults.documentClass;
    const classOptions = docClassMatch[1];
    if (classOptions) {
      const optionsArray = classOptions.split(',').map((o) => o.trim());
      const fontSize = optionsArray.find((o) =>
        o.match(/^\d+(\.\d+)?(pt|cm|mm|in)$/),
      );
      if (fontSize) defaults.fontsize = fontSize;

      const knownPaperSizes = [
        'a4paper',
        'a5paper',
        'b5paper',
        'letterpaper',
        'legalpaper',
      ];
      const paperSize =
        optionsArray.find((o) => knownPaperSizes.includes(o)) ||
        optionsArray.find((o) => o.includes('paper'));
      if (paperSize) defaults.paperSize = paperSize;
    }
  }

  const inputencMatch = content.match(
    /\\usepackage\[([^\]]*)\]\{inputenc\}|\\usepackage\{inputenc\}/,
  );
  if (inputencMatch && inputencMatch[1]) {
    const encoding = inputencMatch[1].trim();
    if (encoding) defaults.encoding = encoding;
  }

  const babelMatch = content.match(
    /\\usepackage\[([^\]]*)\]\{babel\}|\\usepackage\{babel\}/,
  );
  if (babelMatch && babelMatch[1]) {
    const language = babelMatch[1].trim();
    if (language) defaults.language = language;
  }

  const geometryMatch = content.match(
    /\\usepackage\[([^\]]*)\]\{geometry\}|\\usepackage\{geometry\}/,
  );
  if (geometryMatch && geometryMatch[1]) {
    const params = geometryMatch[1];
    const marginMatch = params.match(/margin=([^\s,}]+)/);
    if (marginMatch) {
      const marginValue = marginMatch[1];
      if (marginValue === '2cm') {
        defaults.margins = 'narrow';
      } else if (marginValue === '3cm') {
        defaults.margins = 'wide';
      } else {
        defaults.margins = `margin=${marginValue}`;
      }
    }
  }

  return defaults;
};

export const replaceDocumentPreamble = (
  content: string,
  newSettings: DocumentSettings,
): string => {
  const beginDocumentMatch = content.match(/\\begin\{document\}/);
  if (!beginDocumentMatch) {
    return content;
  }

  const beginIndex = beginDocumentMatch.index || 0;
  const preambleSection = content.substring(0, beginIndex);
  const documentPart = content.substring(beginIndex);

  let updatedPreamble = preambleSection;

  const classOptions = [newSettings.fontsize, newSettings.paperSize]
    .filter(Boolean)
    .join(',');
  const newDocumentClass = `\\documentclass[${classOptions}]{${newSettings.documentClass}}`;
  updatedPreamble = updatedPreamble.replace(
    /\\documentclass\[[^\]]*\]\{[^}]*\}|\\documentclass\{[^}]*\}/,
    newDocumentClass,
  );

  const inputencLine = `\\usepackage[${newSettings.encoding}]{inputenc}`;
  if (updatedPreamble.includes('inputenc}')) {
    updatedPreamble = updatedPreamble.replace(
      /\\usepackage\[[^\]]*\]\{inputenc\}|\\usepackage\{inputenc\}/,
      inputencLine,
    );
  } else {
    updatedPreamble = updatedPreamble.replace(
      /(\}[\n\r]*)/,
      `}\n${inputencLine}\n`,
    );
  }

  const hasBabel = updatedPreamble.includes('babel}');
  const languageMap: Record<string, string> = {
    ngerman: 'ngerman',
    french: 'french',
    spanish: 'spanish',
    italian: 'italian',
  };

  if (newSettings.language && newSettings.language !== 'english') {
    const babelLine = `\\usepackage[${languageMap[newSettings.language] || newSettings.language}]{babel}`;
    if (hasBabel) {
      updatedPreamble = updatedPreamble.replace(
        /\\usepackage\[[^\]]*\]\{babel\}|\\usepackage\{babel\}/,
        babelLine,
      );
    } else {
      updatedPreamble = updatedPreamble.replace(
        /(\n\\begin\{document\})/,
        `\n${babelLine}\n\\begin{document}`,
      );
    }
  } else if (hasBabel) {
    updatedPreamble = updatedPreamble.replace(
      /\\usepackage\[[^\]]*\]\{babel\}\n|\\usepackage\{babel\}\n/,
      '',
    );
  }

  const geometryMatch = updatedPreamble.match(
    /\\usepackage\[([^\]]*)\]\{geometry\}|\\usepackage\{geometry\}/,
  );

  if (newSettings.margins !== 'default') {
    let marginValue: string;

    if (newSettings.margins.startsWith('margin=')) {
      marginValue = newSettings.margins.substring('margin='.length);
    } else {
      marginValue =
        newSettings.margins === 'narrow'
          ? '2cm'
          : newSettings.margins === 'wide'
            ? '3cm'
            : '2.5cm';
    }

    if (geometryMatch && geometryMatch[1]) {
      const existingParams = geometryMatch[1];
      const paramsArray = existingParams
        .split(',')
        .map((p) => p.trim())
        .filter((p) => !p.match(/^margin/));

      paramsArray.push(`margin=${marginValue}`);
      const newGeometryLine = `\\usepackage[${paramsArray.join(', ')}]{geometry}`;

      updatedPreamble = updatedPreamble.replace(
        /\\usepackage\[[^\]]*\]\{geometry\}|\\usepackage\{geometry\}/,
        newGeometryLine,
      );
    } else if (geometryMatch) {
      updatedPreamble = updatedPreamble.replace(
        /\\usepackage\{geometry\}/,
        `\\usepackage[margin=${marginValue}]{geometry}`,
      );
    } else {
      const geometryLine = `\\usepackage[margin=${marginValue}]{geometry}`;
      updatedPreamble = updatedPreamble.replace(
        /(\n\\begin\{document\})/,
        `\n${geometryLine}\n\\begin{document}`,
      );
    }
  } else if (geometryMatch && geometryMatch[1]) {
    const existingParams = geometryMatch[1];
    const paramsArray = existingParams
      .split(',')
      .map((p) => p.trim())
      .filter((p) => !p.match(/^margin/));

    if (paramsArray.length > 0) {
      const newGeometryLine = `\\usepackage[${paramsArray.join(', ')}]{geometry}`;
      updatedPreamble = updatedPreamble.replace(
        /\\usepackage\[[^\]]*\]\{geometry\}/,
        newGeometryLine,
      );
    } else {
      updatedPreamble = updatedPreamble.replace(
        /\\usepackage\[[^\]]*\]\{geometry\}\n|\\usepackage\[[^\]]*\]\{geometry\}/,
        '',
      );
    }
  } else if (geometryMatch && !geometryMatch[1]) {
    updatedPreamble = updatedPreamble.replace(
      /\\usepackage\{geometry\}\n|\\usepackage\{geometry\}/,
      '',
    );
  }

  return updatedPreamble + documentPart;
};

export const getMarginValue = (margins: string): string | null => {
  if (margins === 'default') return null;
  if (margins.startsWith('margin=')) {
    return margins.substring('margin='.length);
  }
  if (margins === 'narrow') return '2cm';
  if (margins === 'wide') return '3cm';
  return '2.5cm';
};

type ApplyDocumentSettingsDeps = {
  editorSetupRef: MutableRefObject<EditorSetup | null>;
  scheduleCompile: () => void;
  setCurrentSettings: (settings: DocumentSettings) => void;
  setDocumentText: (text: string) => void;
};

export const createHandleApplyDocumentSettings = ({
  editorSetupRef,
  scheduleCompile,
  setCurrentSettings,
  setDocumentText,
}: ApplyDocumentSettingsDeps) => {
  return (settings: DocumentSettings) => {
    const editor = editorSetupRef.current?.editor;
    if (!editor) {
      return;
    }

    setCurrentSettings(settings);

    const currentText = editor.getValue();
    const newText = replaceDocumentPreamble(currentText, settings);

    if (newText === currentText) {
      const marginValue = getMarginValue(settings.margins);
      if (marginValue) {
        const geometryLine = `\\usepackage[margin=${marginValue}]{geometry}`;
        const geometryRegex = /\\usepackage(\[[^\]]*\])?\{geometry\}/;
        const fallbackText = geometryRegex.test(currentText)
          ? currentText.replace(geometryRegex, geometryLine)
          : currentText.trim().length > 0
            ? (() => {
                const normalized = currentText.replace(/\r\n/g, '\n');
                const firstLineBreakIndex = normalized.indexOf('\n');
                if (firstLineBreakIndex === -1) {
                  return `${normalized}\n${geometryLine}`;
                }

                const firstLine = normalized.slice(0, firstLineBreakIndex);
                const rest = normalized.slice(firstLineBreakIndex + 1);
                return `${firstLine}\n${geometryLine}\n${rest}`;
              })()
            : `${geometryLine}\n`;

        const model = editor.getModel();
        if (!model) return;

        editor.executeEdits('settings.apply.fallback', [
          {
            range: model.getFullModelRange(),
            text: fallbackText,
            forceMoveMarkers: true,
          },
        ]);
        editor.pushUndoStop();
        setDocumentText(fallbackText);
        scheduleCompile();
        toast.success('Geometry package inserted');
        return;
      }

      toast.info('No document structure found. Create a LaTeX document first.');
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    editor.executeEdits('settings.apply', [
      {
        range: model.getFullModelRange(),
        text: newText,
        forceMoveMarkers: true,
      },
    ]);
    editor.pushUndoStop();
    setDocumentText(newText);
    scheduleCompile();
    toast.success('Document settings applied');
  };
};
