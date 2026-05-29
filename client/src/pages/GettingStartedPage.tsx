import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Code2,
  FileText,
  Image,
  Play,
  Sparkles,
  Video,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const GettingStartedPage: React.FC = () => {
  const placeholderBlocks = [
    {
      title: 'Key Features',
      description: 'Watch the main editor workflow in a larger player.',
      icon: Video,
      src: '/videos/KeyFeatures.mp4',
    },
    {
      title: 'Collaboration',
      description: 'See how live collaboration and teamwork look in TexMex.',
      icon: Image,
      src: '/videos/Collaboration.mp4',
    },
    {
      title: 'Sharing and access',
      description: 'Learn how to share documents and manage access.',
      icon: Sparkles,
      src: '/videos/Sharing.mp4',
    },
  ];

  const latexTopics = [
    'The document structure: class, preamble, title, sections, and environments.',
    'Math basics: inline math, displayed equations, and common commands.',
    'Packages and imports: how to extend LaTeX with extra functionality.',
    'Figures, tables, and references: the everyday building blocks of a paper.',
  ];

  const editorTopics = [
    'Create a new document, open an existing one, and keep your work organized in one place.',
    'Use the editor toolbar and snippets to insert common LaTeX structures faster.',
    'Compile often so the preview stays in sync while you write.',
    'Share a document with teammates and use comments, versions, and roles for collaboration.',
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 md:flex-row md:items-end md:justify-between md:px-6">
          <div className="max-w-2xl space-y-2">
            <Badge variant="secondary" className="w-fit">Getting started</Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Learn TexMex and LaTeX
            </h1>
            <p className="text-sm text-muted-foreground md:text-base">
              This guide shows how to move around the editor, write LaTeX with confidence,
              and use the resources below to deepen your knowledge.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/">
                <ArrowLeft size={16} />
                Back to home
              </Link>
            </Button>
            <Button asChild>
              <a href="https://www.overleaf.com/learn/latex/Learn_LaTeX_in_30_minutes" target="_blank" rel="noreferrer">
                Learn LaTeX
                <ArrowRight size={16} />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-6">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/60 bg-card/95 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <BookOpen size={18} />
                TexMex editor basics
              </CardTitle>
              <CardDescription>
                Start here if you want to understand the core workflow of our editor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {editorTopics.map((topic) => (
                <div key={topic} className="flex gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                    <Code2 size={16} />
                  </div>
                  <p className="text-sm text-muted-foreground">{topic}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/95 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <FileText size={18} />
                LaTeX quick start
              </CardTitle>
              <CardDescription>
                A compact overview of the language concepts you will use most often.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {latexTopics.map((topic) => (
                <div key={topic} className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-3 text-sm text-muted-foreground">
                  {topic}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          {placeholderBlocks.map((block) => {
            const Icon = block.icon;

            return (
              <Card key={block.title} className="border border-dashed border-border/70 bg-card/90 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon size={16} />
                    {block.title}
                  </CardTitle>
                  <CardDescription>{block.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="group relative flex h-64 w-full flex-col overflow-hidden rounded-lg border border-border bg-muted/20 text-left transition-colors hover:bg-muted/30"
                      >
                        <video
                          className="h-full w-full object-cover"
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="metadata"
                        >
                          <source src={block.src} type="video/mp4" />
                          Your browser does not support the video tag.
                        </video>
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-[min(95vw,72rem)] overflow-hidden p-0 sm:max-w-6xl">
                      <div className="space-y-4 p-6">
                        <DialogHeader>
                          <DialogTitle>{block.title}</DialogTitle>
                          <DialogDescription>
                            {block.description}
                          </DialogDescription>
                        </DialogHeader>
                        <video
                          className="max-h-[75vh] w-full rounded-lg border border-border bg-background"
                          controls
                          autoPlay={false}
                          preload="metadata"
                        >
                          <source src={block.src} type="video/mp4" />
                          Your browser does not support the video tag.
                        </video>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            );
          })}
        </section>
        

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/60 bg-card/95 shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">How to use the editor</CardTitle>
              <CardDescription>
                A simple path through TexMex from first document to final PDF.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="space-y-3">
                <li className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                  1. Create a document and start writing in the editor pane.
                </li>
                <li className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                  2. Use snippets, tables, formulas, and file tools to build your project faster.
                </li>
                <li className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                  3. Compile regularly so the preview reflects what you just changed.
                </li>
                <li className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                  4. Share the document with collaborators once you are ready to work together.
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/95 shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">Where to learn LaTeX</CardTitle>
              <CardDescription>
                Use these guides for language basics and a structured introduction.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="outline" asChild className="w-full justify-between">
                <a href="https://www.overleaf.com/learn/latex/Learn_LaTeX_in_30_minutes" target="_blank" rel="noreferrer">
                  Overleaf: Learn LaTeX in 30 minutes
                  <ArrowRight size={16} />
                </a>
              </Button>
              <Button variant="outline" asChild className="w-full justify-between">
                <a href="https://www.learnlatex.org/de/" target="_blank" rel="noreferrer">
                  learnlatex.org (German)
                  <ArrowRight size={16} />
                </a>
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
};

export default GettingStartedPage;
