import type { ReactNode } from 'react';
import { ArrowRightIcon, CheckIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { KindBadge, ScopeBadge, Tag } from '../components/Badge';
import { LogoMark } from '../components/icons';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Public landing page. It is completely static and does not check session or
 * server state. One headline, one explanation, and a small demo of the
 * remember → recall loop, in the same card language as the app.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-6">
        <div className="flex items-center gap-2.5 font-heading text-[17px] font-bold tracking-tight">
          <LogoMark size={24} />
          Echo
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/login" className={cn(buttonVariants({ variant: 'ghost' }))}>
            Log in
          </Link>
          <Link to="/signup" className={cn(buttonVariants())}>
            Sign up
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-12 px-6 py-16">
        <div className="flex flex-col items-start gap-4">
          <h1 className="max-w-xl text-balance font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Give your AI tools a shared memory.
          </h1>
          <p className="max-w-xl text-pretty text-sm/relaxed text-muted-foreground">
            Echo is a self-hosted memory layer for AI apps. Claude, Cursor, and any MCP-compatible
            tool can save what they learn and recall it later — scoped to you, your team, or your
            whole organization.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Link to="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
              Get started
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
            <Link to="/login" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
              Log in
            </Link>
          </div>
        </div>

        {/* Remember → recall demo, in the app's tray + preview-well card anatomy. */}
        <div className="grid gap-1.5 rounded-[16px] border border-grayscale-3 bg-grayscale-2 p-1.5 animate-in fade-in slide-in-from-bottom-4 duration-700 motion-reduce:animate-none sm:grid-cols-2">
          <DemoCard label="In Claude Code">
            <div className="flex w-full max-w-xs flex-col gap-2.5">
              <div className="self-end rounded-lg rounded-br-sm bg-grayscale-12 px-3 py-2 text-xs/relaxed text-grayscale-1">
                Use Echo to remember that I prefer concise answers.
              </div>
              <div className="flex items-center gap-1.5 self-start text-xs text-muted-foreground">
                <span className="flex size-4 items-center justify-center rounded-full bg-success/15 text-success">
                  <CheckIcon className="size-2.5" />
                </span>
                Saved to your personal scope.
              </div>
            </div>
          </DemoCard>
          <DemoCard label="Later, in any connected app">
            <div className="w-full max-w-xs rounded-lg border border-grayscale-3 bg-grayscale-1 p-3 shadow-card dark:border-grayscale-5 dark:bg-grayscale-3 dark:shadow-none">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <ScopeBadge type="personal" />
                <KindBadge kind="explicit" />
                <span className="ms-auto text-[11px]">just now</span>
              </div>
              <p className="mt-2 text-xs/relaxed">Prefers concise answers.</p>
              <div className="mt-2.5 flex gap-1.5">
                <Tag tag="preferences" />
              </div>
            </div>
          </DemoCard>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-3xl px-6 pb-8">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Echo — self-hosted memory for AI tools
        </span>
      </footer>
    </div>
  );
}

/** A non-interactive preview-well card with a mono caption, dqnamo style. */
function DemoCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[13px] border border-grayscale-3 bg-grayscale-1 p-1 shadow-card dark:border-grayscale-4 dark:bg-grayscale-3 dark:shadow-none">
      <div className="flex min-h-40 flex-1 items-center justify-center rounded-lg bg-grayscale-2 p-4 dark:bg-grayscale-2">
        {children}
      </div>
      <div className="px-2 pt-2.5 pb-1.5">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-grayscale-9">
          {label}
        </span>
      </div>
    </div>
  );
}
