import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Portfolio, Investment, AssetClass } from '../types';

interface PortfolioState {
  portfolios: Portfolio[];
  createPortfolio: (name: string, description: string) => void;
  deletePortfolio: (id: string) => void;
  addInvestment: (portfolioId: string, investment: Omit<Investment, 'id' | 'addedAt'>) => void;
  removeInvestment: (portfolioId: string, investmentId: string) => void;
}

function uuid() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

const SAMPLE_PORTFOLIOS: Portfolio[] = [
  {
    id: 'p1',
    name: 'Growth Tech',
    description: 'High-growth technology positions',
    createdAt: new Date().toISOString(),
    investments: [
      { id: 'i1', symbol: 'NVDA', name: 'NVIDIA Corp.', assetClass: 'stock' as AssetClass, quantity: 50, avgCost: 118, addedAt: new Date().toISOString() },
      { id: 'i2', symbol: 'MSFT', name: 'Microsoft Corp.', assetClass: 'stock' as AssetClass, quantity: 25, avgCost: 388, addedAt: new Date().toISOString() },
      { id: 'i3', symbol: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'etf' as AssetClass, quantity: 30, avgCost: 455, addedAt: new Date().toISOString() },
    ],
  },
  {
    id: 'p2',
    name: 'Crypto Core',
    description: 'Digital asset long-term holds',
    createdAt: new Date().toISOString(),
    investments: [
      { id: 'i4', symbol: 'BTC/USD', name: 'Bitcoin', assetClass: 'crypto' as AssetClass, quantity: 0.5, avgCost: 68000, addedAt: new Date().toISOString() },
      { id: 'i5', symbol: 'ETH/USD', name: 'Ethereum', assetClass: 'crypto' as AssetClass, quantity: 5, avgCost: 3100, addedAt: new Date().toISOString() },
    ],
  },
];

export const usePortfolioStore = create<PortfolioState>()(
  persist(
    (set) => ({
      portfolios: SAMPLE_PORTFOLIOS,

      createPortfolio: (name, description) =>
        set((state) => ({
          portfolios: [
            ...state.portfolios,
            { id: uuid(), name, description, createdAt: new Date().toISOString(), investments: [] },
          ],
        })),

      deletePortfolio: (id) =>
        set((state) => ({ portfolios: state.portfolios.filter((p) => p.id !== id) })),

      addInvestment: (portfolioId, investment) =>
        set((state) => ({
          portfolios: state.portfolios.map((p) =>
            p.id === portfolioId
              ? { ...p, investments: [...p.investments, { ...investment, id: uuid(), addedAt: new Date().toISOString() }] }
              : p
          ),
        })),

      removeInvestment: (portfolioId, investmentId) =>
        set((state) => ({
          portfolios: state.portfolios.map((p) =>
            p.id === portfolioId
              ? { ...p, investments: p.investments.filter((i) => i.id !== investmentId) }
              : p
          ),
        })),
    }),
    { name: 'rally-portfolios' }
  )
);
