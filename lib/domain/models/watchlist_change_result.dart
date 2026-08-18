/// Result of a watchlist modification attempt.
///
/// Used to communicate the outcome of add/remove operations on the watchlist,
/// including success, duplicates, capacity limits, and persistence warnings.
sealed class WatchlistChangeResult {
  const WatchlistChangeResult();
}

/// A symbol was successfully added to the watchlist.
class WatchlistSymbolAdded extends WatchlistChangeResult {
  final String symbol;
  const WatchlistSymbolAdded(this.symbol);
}

/// The symbol already exists on the watchlist; no change was made.
class WatchlistAlreadyExists extends WatchlistChangeResult {
  final String symbol;
  const WatchlistAlreadyExists(this.symbol);
}

/// The watchlist is at maximum capacity (50 symbols); the add was rejected.
class WatchlistAtCapacity extends WatchlistChangeResult {
  const WatchlistAtCapacity();
}

/// A symbol was successfully removed from the watchlist.
class WatchlistSymbolRemoved extends WatchlistChangeResult {
  final String symbol;
  const WatchlistSymbolRemoved(this.symbol);
}

/// The watchlist was modified in memory but persistence failed.
///
/// Changes may not survive across app sessions.
class WatchlistPersistenceWarning extends WatchlistChangeResult {
  final String message;
  const WatchlistPersistenceWarning(this.message);
}
