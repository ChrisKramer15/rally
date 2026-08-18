import 'dart:math';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/models/enums.dart';
import '../../domain/models/ohlc_candle.dart';
import '../blocs/chart_bloc.dart';
import '../theme/neon_theme.dart';

/// A chart widget that renders either a line chart or candlestick chart
/// based on the current [ChartBloc] state.
///
/// - Default: line chart displaying close prices over time.
/// - Toggle: switches between line and candlestick views.
/// - Handles insufficient data (< 2 points) with a message.
/// - Skips invalid OHLC candles where high < low.
class ChartWidget extends StatelessWidget {
  /// Animation duration for chart transitions. Set to [Duration.zero] in tests.
  final Duration animationDuration;

  const ChartWidget({
    super.key,
    this.animationDuration = const Duration(milliseconds: 300),
  });

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChartBloc, ChartState>(
      builder: (context, state) {
        return Column(
          children: [
            _buildToggleButton(context, state),
            const SizedBox(height: 8),
            Expanded(child: _buildChartContent(context, state)),
          ],
        );
      },
    );
  }

  /// Builds the chart type toggle button with visual indication of active type.
  Widget _buildToggleButton(BuildContext context, ChartState state) {
    final chartType = _chartTypeFromState(state);
    final brightness = Theme.of(context).brightness;
    final accentColor = NeonColors.accent(brightness);

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _ChartTypeToggle(
          currentType: chartType,
          accentColor: accentColor,
          onToggle: () {
            context.read<ChartBloc>().add(const ToggleChartType());
          },
        ),
      ],
    );
  }

  /// Builds the chart content based on the current BLoC state.
  Widget _buildChartContent(BuildContext context, ChartState state) {
    if (state is ChartLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state is InsufficientData) {
      return _buildInsufficientDataMessage(context);
    }

    if (state is ChartError) {
      return _buildErrorMessage(context, state.message);
    }

    if (state is ChartLoaded) {
      final validCandles = _filterValidCandles(state.candles);
      if (validCandles.length < 2) {
        return _buildInsufficientDataMessage(context);
      }

      if (state.chartType == ChartType.candlestick) {
        return _CandlestickChart(candles: validCandles);
      } else {
        return _LineChartView(
          candles: validCandles,
          animationDuration: animationDuration,
        );
      }
    }

    // ChartInitial or any other state
    return const Center(
      child: Text('Select an asset to view chart'),
    );
  }

  Widget _buildInsufficientDataMessage(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.show_chart,
            size: 48,
            color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5),
          ),
          const SizedBox(height: 16),
          Text(
            'Insufficient data',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Not enough data points to render the chart.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _buildErrorMessage(BuildContext context, String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.error_outline,
            size: 48,
            color: NeonColors.shortRed(Theme.of(context).brightness),
          ),
          const SizedBox(height: 16),
          Text(
            'Chart Error',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: Theme.of(context).textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  /// Extracts the current chart type from any state.
  ChartType _chartTypeFromState(ChartState state) {
    if (state is ChartLoaded) return state.chartType;
    if (state is ChartLoading) return state.currentType;
    if (state is ChartError) return state.chartType;
    if (state is InsufficientData) return state.chartType;
    return ChartType.line;
  }

  /// Filters out invalid OHLC candles where high < low.
  List<OhlcCandle> _filterValidCandles(List<OhlcCandle> candles) {
    return candles.where((c) => c.high >= c.low).toList();
  }
}

/// Toggle button widget showing line/candlestick icons with visual highlight.
class _ChartTypeToggle extends StatelessWidget {
  final ChartType currentType;
  final Color accentColor;
  final VoidCallback onToggle;

  const _ChartTypeToggle({
    required this.currentType,
    required this.accentColor,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final surfaceColor = brightness == Brightness.dark
        ? NeonColors.darkSurface
        : NeonColors.lightSurface;

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        color: surfaceColor,
      ),
      child: ToggleButtons(
        isSelected: [
          currentType == ChartType.line,
          currentType == ChartType.candlestick,
        ],
        onPressed: (index) {
          final selected =
              index == 0 ? ChartType.line : ChartType.candlestick;
          if (selected != currentType) {
            onToggle();
          }
        },
        borderRadius: BorderRadius.circular(8),
        selectedColor: accentColor,
        color: Theme.of(context).colorScheme.onSurface,
        fillColor: accentColor.withOpacity(0.15),
        selectedBorderColor: accentColor,
        constraints: const BoxConstraints(
          minWidth: 48,
          minHeight: 36,
        ),
        children: [
          Tooltip(
            message: 'Line Chart',
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Icon(
                Icons.show_chart,
                size: 20,
                semanticLabel: 'Line chart',
              ),
            ),
          ),
          Tooltip(
            message: 'Candlestick Chart',
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Icon(
                Icons.candlestick_chart,
                size: 20,
                semanticLabel: 'Candlestick chart',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Line chart view rendering close prices over time using fl_chart.
class _LineChartView extends StatelessWidget {
  final List<OhlcCandle> candles;
  final Duration animationDuration;

  const _LineChartView({
    required this.candles,
    required this.animationDuration,
  });

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final lineColor = NeonColors.accent(brightness);
    final gridColor = Theme.of(context).colorScheme.onSurface.withOpacity(0.1);

    final spots = <FlSpot>[];
    for (int i = 0; i < candles.length; i++) {
      spots.add(FlSpot(i.toDouble(), candles[i].close));
    }

    final minY = candles.map((c) => c.close).reduce(min);
    final maxY = candles.map((c) => c.close).reduce(max);
    final padding = (maxY - minY) * 0.1;

    return Padding(
      padding: const EdgeInsets.only(right: 16, top: 8, bottom: 8),
      child: LineChart(
        LineChartData(
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: _calculateInterval(minY, maxY),
            getDrawingHorizontalLine: (value) => FlLine(
              color: gridColor,
              strokeWidth: 0.5,
            ),
          ),
          titlesData: FlTitlesData(
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 60,
                getTitlesWidget: (value, meta) => Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Text(
                    value.toStringAsFixed(2),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontSize: 10,
                        ),
                  ),
                ),
              ),
            ),
            bottomTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
          ),
          borderData: FlBorderData(show: false),
          minX: 0,
          maxX: (candles.length - 1).toDouble(),
          minY: minY - padding,
          maxY: maxY + padding,
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              curveSmoothness: 0.2,
              color: lineColor,
              barWidth: 2,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                color: lineColor.withOpacity(0.1),
              ),
            ),
          ],
          lineTouchData: LineTouchData(
            touchTooltipData: LineTouchTooltipData(
              getTooltipItems: (touchedSpots) {
                return touchedSpots.map((spot) {
                  return LineTooltipItem(
                    spot.y.toStringAsFixed(2),
                    TextStyle(
                      color: lineColor,
                      fontWeight: FontWeight.bold,
                    ),
                  );
                }).toList();
              },
            ),
          ),
        ),
        duration: animationDuration,
      ),
    );
  }

  double _calculateInterval(double minY, double maxY) {
    final range = maxY - minY;
    if (range <= 0) return 1;
    // Aim for ~5 grid lines
    final rawInterval = range / 5;
    // Round to a nice number
    final magnitude = pow(10, (log(rawInterval) / ln10).floor()).toDouble();
    return (rawInterval / magnitude).ceil() * magnitude;
  }
}

/// Candlestick chart using custom painting over fl_chart's BarChart.
///
/// Renders each candle with:
/// - Body: top = max(open, close), bottom = min(open, close)
/// - Wicks: top = high, bottom = low
/// - Bullish (close > open): NeonColors.buyGreen
/// - Bearish (close < open): NeonColors.shortRed
class _CandlestickChart extends StatelessWidget {
  final List<OhlcCandle> candles;

  const _CandlestickChart({required this.candles});

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final gridColor = Theme.of(context).colorScheme.onSurface.withOpacity(0.1);

    final allPrices = candles.expand((c) => [c.high, c.low]);
    final minY = allPrices.reduce(min);
    final maxY = allPrices.reduce(max);
    final padding = (maxY - minY) * 0.1;

    return Padding(
      padding: const EdgeInsets.only(right: 16, top: 8, bottom: 8),
      child: BarChart(
        BarChartData(
          alignment: BarChartAlignment.spaceEvenly,
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: _calculateInterval(minY, maxY),
            getDrawingHorizontalLine: (value) => FlLine(
              color: gridColor,
              strokeWidth: 0.5,
            ),
          ),
          titlesData: FlTitlesData(
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 60,
                getTitlesWidget: (value, meta) => Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Text(
                    value.toStringAsFixed(2),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontSize: 10,
                        ),
                  ),
                ),
              ),
            ),
            bottomTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
          ),
          borderData: FlBorderData(show: false),
          minY: minY - padding,
          maxY: maxY + padding,
          barGroups: _buildBarGroups(brightness, minY - padding),
          barTouchData: BarTouchData(
            touchTooltipData: BarTouchTooltipData(
              getTooltipItem: (group, groupIndex, rod, rodIndex) {
                if (groupIndex >= candles.length) return null;
                final candle = candles[groupIndex];
                return BarTooltipItem(
                  'O: ${candle.open.toStringAsFixed(2)}\n'
                  'H: ${candle.high.toStringAsFixed(2)}\n'
                  'L: ${candle.low.toStringAsFixed(2)}\n'
                  'C: ${candle.close.toStringAsFixed(2)}',
                  TextStyle(
                    color: _candleColor(candle, brightness),
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  /// Builds bar groups representing candlesticks.
  ///
  /// Each candlestick is rendered as a bar with:
  /// - A thin rod for the wick (high to low)
  /// - A thicker rod for the body (open/close range)
  List<BarChartGroupData> _buildBarGroups(Brightness brightness, double baseY) {
    final groups = <BarChartGroupData>[];

    for (int i = 0; i < candles.length; i++) {
      final candle = candles[i];
      final color = _candleColor(candle, brightness);

      final bodyTop = max(candle.open, candle.close);
      final bodyBottom = min(candle.open, candle.close);

      groups.add(
        BarChartGroupData(
          x: i,
          barRods: [
            // Wick rod (thin, full high-low range)
            BarChartRodData(
              fromY: candle.low,
              toY: candle.high,
              width: 1.5,
              color: color,
              borderRadius: BorderRadius.zero,
            ),
            // Body rod (thicker, open-close range)
            BarChartRodData(
              fromY: bodyBottom,
              toY: bodyTop == bodyBottom ? bodyTop + 0.01 : bodyTop,
              width: _calculateBodyWidth(),
              color: color,
              borderRadius: BorderRadius.circular(1),
            ),
          ],
        ),
      );
    }

    return groups;
  }

  /// Returns the color for a candle based on bullish/bearish direction.
  Color _candleColor(OhlcCandle candle, Brightness brightness) {
    if (candle.close > candle.open) {
      return NeonColors.buyGreen(brightness);
    } else {
      return NeonColors.shortRed(brightness);
    }
  }

  /// Calculates a reasonable body width based on the number of candles.
  double _calculateBodyWidth() {
    if (candles.length <= 10) return 12;
    if (candles.length <= 30) return 8;
    if (candles.length <= 60) return 5;
    return 3;
  }

  double _calculateInterval(double minY, double maxY) {
    final range = maxY - minY;
    if (range <= 0) return 1;
    final rawInterval = range / 5;
    final magnitude = pow(10, (log(rawInterval) / ln10).floor()).toDouble();
    return (rawInterval / magnitude).ceil() * magnitude;
  }
}
