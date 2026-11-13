import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth";
import Login from "../screens/Login";
export default function Route() {
  return useAuth().session ? <Redirect href="/" /> : <Login />;
}
