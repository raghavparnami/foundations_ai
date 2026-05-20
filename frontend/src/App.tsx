import { createBrowserRouter, RouterProvider } from "react-router";
import Layout from "./routes/Layout";
import Home from "./routes/Home";
import Chat from "./routes/Chat";
import Connections from "./routes/Connections";
import Skills from "./routes/Skills";
import Memory from "./routes/Memory";
import Admin from "./routes/Admin";
import Wiki from "./routes/Wiki";
import WikiPage from "./routes/WikiPage";

const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "chat", Component: Chat },
      { path: "connections", Component: Connections },
      { path: "skills", Component: Skills },
      { path: "memory", Component: Memory },
      { path: "admin", Component: Admin },
      { path: "wiki", Component: Wiki },
      { path: "wiki/*", Component: WikiPage },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
