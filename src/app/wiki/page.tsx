import WikiLayout from "@/components/wiki/WikiLayout";
import WikiHome from "@/components/wiki/WikiHome";

export default function WikiIndexPage() {
  return (
    <WikiLayout activeSlug={null}>
      <WikiHome />
    </WikiLayout>
  );
}
