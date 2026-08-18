import '../models/chart_data.dart';
import '../models/enums.dart';

/// Abstract interface for managing chart state and data loading.
///
/// Handles loading chart data for assets across different time durations,
/// and toggling between line and candlestick chart display types.
abstract class IChartController {
  /// Load chart data for an asset identified by [symbol] at the given
  /// [duration].
  ///
  /// Returns chart data suitable for rendering either line or candlestick
  /// charts.
  Future<ChartData> loadChartData({
    required String symbol,
    required TimeDuration duration,
  });

  /// Toggle between line and candlestick chart types.
  ///
  /// Returns the new [ChartType] after toggling.
  ChartType toggleChartType();

  /// Get the current chart display type (line or candlestick).
  ChartType get currentChartType;
}
