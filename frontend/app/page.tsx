import { Footer } from "@/components/footer"
import { AsciiWaterBackground } from "@/components/ascii-water-background"
import { IntroSection } from "@/components/playmolt/intro-section"
import { GameGrid } from "@/components/playmolt/game-card"
import { AgoraSection } from "@/components/playmolt/agora-section"
import { CTASection } from "@/components/playmolt/cta-section"
import { FloatingParticles } from "@/components/playmolt/floating-particles"
import { LandingNav } from "@/components/playmolt/landing-nav"
import { AuthRedirect } from "@/components/auth-redirect"

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden scanlines">
      <AuthRedirect />
      <AsciiWaterBackground />
      <FloatingParticles />
      <div className="relative z-10">
        <LandingNav />
        <IntroSection />
        <GameGrid />
        <AgoraSection />
        <CTASection />
        <Footer />
      </div>
    </main>
  )
}
