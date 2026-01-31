import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <BrowserRouter basename="/portal">
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<AuthPage />} />

        {/* Protected routes with Layout */}
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/settings/token" element={<div>API 토큰 페이지 (준비 중)</div>} />
          <Route path="/settings" element={<div>설정 페이지 (준비 중)</div>} />
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
