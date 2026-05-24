import { useRoutes } from "react-router-dom";
import { routes } from "./router";

export function App() {
  const element = useRoutes(routes);

  return element;
}
