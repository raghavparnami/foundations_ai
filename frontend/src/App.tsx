import { createBrowserRouter, RouterProvider } from "react-router";
import Layout from "./routes/Layout";
import Home from "./routes/Home";
import Converse from "./routes/Converse";
import Weave from "./routes/Weave";
import Chat from "./routes/Chat";
import Connections from "./routes/Connections";
import Skills from "./routes/Skills";
import Memory from "./routes/Memory";
import Admin from "./routes/Admin";
import Wiki from "./routes/Wiki";
import WikiPage from "./routes/WikiPage";
import Ledger from "./routes/Ledger";
import Spend from "./routes/Spend";

const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      // New home: The Weave · vertical persistent threads, geometry-as-story.
      { index: true, Component: Weave },
      // Previous transcript home, kept at /converse for fallback.
      { path: "converse", Component: Converse },
      // Legacy SR + standing-meeting view, kept as a read-only roster.
      { path: "roster", Component: Home },
      // Legacy chat-thread route still accessible for power users.
      { path: "chat", Component: Chat },
      { path: "connections", Component: Connections },
      { path: "skills", Component: Skills },
      { path: "memory", Component: Memory },
      { path: "admin", Component: Admin },
      { path: "wiki", Component: Wiki },
      { path: "wiki/*", Component: WikiPage },
      { path: "ledger", Component: Ledger },
      { path: "spend", Component: Spend },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
