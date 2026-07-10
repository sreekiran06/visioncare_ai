import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../services/api";

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await authApi.login(email, password);
      localStorage.setItem("vc_access_token", res.data.access_token);
      navigate("/dashboard");
    } catch {
      setError("Incorrect email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">
            👁️
          </div>
          <h1 className="text-2xl font-display font-bold text-white">
            VisionCare AI
          </h1>
          <p className="text-white/50 text-sm mt-1">Nurse dashboard sign-in</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-card p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-ink-800 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2
                         focus:border-signal-teal focus:ring-1 focus:ring-signal-teal"
              placeholder="nurse@hospital.org"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-800 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2
                         focus:border-signal-teal focus:ring-1 focus:ring-signal-teal"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-signal-coral text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-signal-teal text-white rounded-lg font-medium
                       hover:bg-signal-teal/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
