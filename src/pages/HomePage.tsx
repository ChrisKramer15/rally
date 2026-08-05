import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusCircle, Trash2, Briefcase, ChevronRight } from 'lucide-react';
import { usePortfolioStore } from '../store/portfolioStore';

export default function HomePage() {
  const { portfolios, createPortfolio, deletePortfolio } = usePortfolioStore();
  const navigate = useNavigate();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [toDelete, setToDelete] = useState<string | null>(null);

  const handleCreate = () => {
    if (!name.trim()) return;
    createPortfolio(name.trim(), description.trim());
    setName('');
    setDescription('');
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    deletePortfolio(id);
    setToDelete(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">My Portfolios</h1>
          <p className="text-sm text-slate-400 mt-0.5">{portfolios.length} portfolio{portfolios.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <PlusCircle size={16} />
          New Portfolio
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-5 mb-6">
          <h2 className="text-base font-semibold text-white mb-4">Create Portfolio</h2>
          <div className="grid gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="p-name">Name *</label>
              <input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dividend Growth"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="p-desc">Description</label>
              <input
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!name.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portfolio cards */}
      {portfolios.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Briefcase size={40} className="mx-auto mb-3 opacity-30" />
          <p>No portfolios yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolios.map((p) => (
            <div
              key={p.id}
              className="bg-slate-800 border border-slate-700 hover:border-indigo-500 rounded-xl p-5 cursor-pointer transition-colors group"
              onClick={() => navigate(`/portfolio/${p.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-indigo-600/20 rounded-lg flex items-center justify-center">
                    <Briefcase size={16} className="text-indigo-400" />
                  </div>
                  <h2 className="font-semibold text-white group-hover:text-indigo-300 transition-colors">{p.name}</h2>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setToDelete(p.id); }}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1"
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {p.description && <p className="text-xs text-slate-400 mb-3">{p.description}</p>}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{p.investments.length} investment{p.investments.length !== 1 ? 's' : ''}</span>
                <span className="flex items-center gap-0.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  View <ChevronRight size={12} />
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Created {new Date(p.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm modal */}
      {toDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-base font-semibold text-white mb-2">Delete Portfolio?</h3>
            <p className="text-sm text-slate-400 mb-4">
              This will permanently remove the portfolio and all its investments.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(toDelete)}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setToDelete(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
