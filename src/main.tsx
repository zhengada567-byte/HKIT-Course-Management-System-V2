import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app/App";
import { AuthProvider } from "./contexts/AuthContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { AcademicYearProvider } from "./contexts/AcademicYearContext";
import { FeatureUpdateLockProvider } from "./contexts/FeatureUpdateLockContext";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <AcademicYearProvider>
            <FeatureUpdateLockProvider>
              <App />
            </FeatureUpdateLockProvider>
          </AcademicYearProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);
