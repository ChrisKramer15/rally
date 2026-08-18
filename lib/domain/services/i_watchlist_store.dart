import '../models/watchlist_change_result.dart';

/// Abstract interface for watchlist persistence.
///
/// Defines operations for managing a user-curated list of asset symbols
/// (max 50). Implementations handle the underlying storage mechanism.
abstract class IWatchlistStore {
  /// Returns the current watchlist symbols.
  List<String> getWatchlist();

  /// Adds a symbol to the watchlist.
  ///
  /// Returns [WatchlistSymbolAdded] on success, [WatchlistAlreadyExists] if
  /// the symbol is already present, [WatchlistAtCapacity] if the watchlist
  /// has reached 50 items, or [WatchlistPersistenceWarning] if the in-memory
  /// add succeeded but persistence failed.
  Future<WatchlistChangeResult> addSymbol(String symbol);

  /// Removes a symbol from the watchlist.
  ///
  /// Returns [WatchlistSymbolRemoved] on success, or
  /// [WatchlistPersistenceWarning] if the in-memory removal succeeded but
  /// persistence failed.
  Future<WatchlistChangeResult> removeSymbol(String symbol);

  /// Returns true if the watchlist contains [symbol].
  bool contains(String symbol);

  /// Returns true if the watchlist has reached capacity (50 items).
  bool isAtCapacity();
}
