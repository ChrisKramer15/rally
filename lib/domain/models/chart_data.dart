import 'enums.dart';
import 'ohlc_candle.dart';

/// Chart data suitable for rendering line or candlestick charts.
class ChartData {
  final String symbol;
  final TimeDuration duration;
  final List<OhlcCandle> candles;

  const ChartData({
    required this.symbol,
    required this.duration,
    required this.candles,
  });

  /// Whether there is sufficient data to render a chart (at least 2 points).
  bool get hasSufficientData => candles.length >= 2;
}
