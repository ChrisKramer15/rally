/// Exception thrown when market data operations fail.
///
/// This includes JSON parsing failures (missing/invalid fields),
/// HTTP errors, and WebSocket communication issues.
class MarketDataException implements Exception {
  /// A human-readable description of the error.
  final String message;

  const MarketDataException(this.message);

  @override
  String toString() => 'MarketDataException: $message';
}
