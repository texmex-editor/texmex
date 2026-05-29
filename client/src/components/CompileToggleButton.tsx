import React from 'react'
import { Button } from '@/components/ui/button'

interface CompileToggleButtonProps {
  isCompilingOn: boolean
  onToggleCompiling: () => void
}

export const CompileToggleButton: React.FC<CompileToggleButtonProps> = ({ isCompilingOn, onToggleCompiling }) => {
  return (
    <Button onClick={onToggleCompiling} variant="outline" size="sm" className="w-34 flex flex-row">
      <span
        className={`mr-1 h-2 w-2 rounded-full ${isCompilingOn ? 'bg-green-500' : 'bg-red-500'}`}
        aria-hidden="true"
      />
      {isCompilingOn ? 'Rendering On' : 'Rendering Off'}
    </Button>
  )
}

