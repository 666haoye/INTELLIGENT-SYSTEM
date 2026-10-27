import HomeExperience from "@/components/HomeExperience";
import PasswordGate from "@/components/PasswordGate";

export default function Page() {
  return (
    <PasswordGate>
      <HomeExperience />
    </PasswordGate>
  );
}
