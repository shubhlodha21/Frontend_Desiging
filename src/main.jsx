import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import MdScreen, { MdMobile, MdMobileFocus, MdMobileCommand } from "./MdScreen.jsx";
import AdminScreen from "./AdminScreen.jsx";
import "./index.css";

// MD desk screen is the default; the original study dashboard stays at ?study=1.
// Mobile concepts are opt-in by number — desktop stays default at any width:
//   ?mobile=1  bottom-nav deck   ?mobile=2  focus / swipe   ?mobile=3  command / order-first
// Bare ?mobile falls back to concept 1.
const MOBILES = { "1": MdMobile, "2": MdMobileFocus, "3": MdMobileCommand };
const params = new URLSearchParams(location.search);
const isStudy = params.has("study");
// ?admin=1 → the desk approval queue. Checked before the phone-width rule so it
// stays reachable from a phone (approving on the move is the point).
const isAdmin = params.has("admin");
const isPhone = window.matchMedia("(max-width: 767px)").matches;
// Phones auto-get the finalized mobile screen; desktop gets the full cockpit.
// ?mobile=1|2|3 forces a specific concept; ?desktop forces the cockpit.
const Mobile = params.has("mobile")
  ? (MOBILES[params.get("mobile")] ?? MdMobile)
  : (isPhone && !params.has("desktop") ? MdMobile : null);
const Screen = isAdmin ? AdminScreen : isStudy ? App : Mobile ?? MdScreen;

class EB extends React.Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  render() {
    if (this.state.e) return <pre style={{ padding: 20, color: "#b91c1c", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>{String(this.state.e && this.state.e.stack || this.state.e)}</pre>;
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EB><Screen /></EB>
  </React.StrictMode>,
);
