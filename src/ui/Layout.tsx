import { Outlet } from "react-router-dom";

export function Layout() {
  return (
    <div style={{ fontFamily: "system-ui", width: "100%", minHeight: "100vh" }}>
      <Outlet />
    </div>
  );
}