import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import React, { useEffect, useMemo, useState } from 'react';

export const ThemeToggleButton: React.FC = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = useMemo(() => resolvedTheme === 'dark', [resolvedTheme]);

  if (!mounted) {
    return (
      <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled>
        <span className="sr-only">Toggle dark mode</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-8 w-8"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle dark mode"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      <span className="sr-only">Toggle dark mode</span>
    </Button>
  );
};

