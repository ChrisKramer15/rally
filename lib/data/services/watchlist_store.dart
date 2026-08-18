import 'package:shared_preferences/shared_preferences.dart';

import '../../domain/models/watchlist_change_result.dart';
import '../../domain/services/i_watchlist_store.dart';

/// Concrete implementation of [IWatchlistStore] backed by [SharedPreferences].
///
/// Persists watchlist symbols as a `List<String>` under the key
/// `'watchlist_symbols'`. Enforces a maximum capacity of 50 symbols,
/// rejects duplicates, and retains in-memory state if persistence fails.
class WatchlistStore implements IWatchlistStore {
  static const String _key = 'watchlist_symbols';
  static const int maxCapacity = 50;

  final SharedPreferences _prefs;
  final List<String> _symbols;

  WatchlistStore._({required SharedPreferences prefs, required List<String> symbols})
      : _prefs = prefs,
        _symbols = symbols;

  /// Creates a [WatchlistStore] by loading any previously persisted symbols
  /// from [SharedPreferences].
  factory WatchlistStore({required SharedPreferences prefs}) {
    final stored = prefs.getStringList(_key) ?? <String>[];
    return WatchlistStore._(prefs: prefs, symbols: List<String>.from(stored));
  }

  @override
  List<String> getWatchlist() => List<String>.unmodifiable(_symbols);

  @override
  Future<WatchlistChangeResult> addSymbol(String symbol) async {
    if (_symbols.contains(symbol)) {
      return WatchlistAlreadyExists(symbol);
    }

    if (_symbols.length >= maxCapacity) {
      return const WatchlistAtCapacity();
    }

    _symbols.add(symbol);

    final persisted = await _persist();
    if (!persisted) {
      return WatchlistPersistenceWarning(
        'Failed to persist watchlist after adding $symbol. '
        'Changes may not survive across app sessions.',
      );
    }

    return WatchlistSymbolAdded(symbol);
  }

  @override
  Future<WatchlistChangeResult> removeSymbol(String symbol) async {
    _symbols.remove(symbol);

    final persisted = await _persist();
    if (!persisted) {
      return WatchlistPersistenceWarning(
        'Failed to persist watchlist after removing $symbol. '
        'Changes may not survive across app sessions.',
      );
    }

    return WatchlistSymbolRemoved(symbol);
  }

  @override
  bool contains(String symbol) => _symbols.contains(symbol);

  @override
  bool isAtCapacity() => _symbols.length >= maxCapacity;

  /// Attempts to persist the current in-memory watchlist to SharedPreferences.
  /// Returns `true` on success, `false` on failure.
  Future<bool> _persist() async {
    try {
      return await _prefs.setStringList(_key, _symbols);
    } catch (_) {
      return false;
    }
  }
}
