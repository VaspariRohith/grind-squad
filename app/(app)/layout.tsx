import { AppProvider } from "@/components/AppProvider";
import BottomNav from "@/components/BottomNav";
import InstallHint from "@/components/InstallHint";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <main className="pb-nav mx-auto w-full max-w-md px-4">
        <InstallHint />
        {children}
      </main>
      <BottomNav />
    </AppProvider>
  );
}
