import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import PortfolioPage from './pages/PortfolioPage';
import MarketsPage from './pages/MarketsPage';
import ValuationPage from './pages/ValuationPage';
import TradeIdeasPage from './pages/TradeIdeasPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/portfolio/:id" element={<PortfolioPage />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/valuation/:symbol" element={<ValuationPage />} />
          <Route path="/ideas" element={<TradeIdeasPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
