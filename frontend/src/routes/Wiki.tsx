import WikiSidebar from "../components/wiki/WikiSidebar";
import WikiHome from "../components/wiki/WikiHome";

export default function Wiki() {
  return (
    <div className="flex h-full">
      <WikiSidebar activeSlug={null} />
      <WikiHome />
    </div>
  );
}
