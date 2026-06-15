import Nav from "@/components/landing/Nav";
import Hero from "@/components/landing/Hero";
import Marquee from "@/components/landing/Marquee";
import PainPoints from "@/components/landing/PainPoints";
import Features from "@/components/landing/Features";
import Workflow from "@/components/landing/Workflow";
import CTA from "@/components/landing/CTA";
import Footer from "@/components/landing/Footer";

export default function Home() {
  return (
    <main>
      <Nav />
      <Hero />
      <Marquee />
      <PainPoints />
      <Features />
      <Workflow />
      <CTA />
      <Footer />
    </main>
  );
}
