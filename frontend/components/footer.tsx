import { Heart } from "lucide-react"
import { BackendHealth } from "@/components/backend-health"

export function Footer() {
  return (
    <footer className="border-t border-border/30 px-4 sm:px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-xs text-muted-foreground">
            <BackendHealth />
            <span className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span>Forged with</span>
            <Heart className="h-3.5 w-3.5 text-destructive animate-pulse" />
            <span>& code</span>
            </span>
          </div>

          <p className="font-mono text-xs text-muted-foreground text-center sm:text-right">
            &copy; {new Date().getFullYear()} PLAYMOLT &mdash; All experiments reserved
          </p>
        </div>
      </div>
    </footer>
  )
}
