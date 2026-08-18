import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/models/enums.dart';
import '../../domain/models/recommendation.dart';
import '../blocs/valuations_bloc.dart';
import '../theme/neon_theme.dart';

/// Screen displaying trade recommendations sorted by R:R descending.
///
/// Uses [ValuationsBloc] to reactively display recommendations with
/// distinct neon colors per trade category and directional icons for
/// accessibility (buy = arrow_upward, short = arrow_downward).
class RecommendationsScreen extends StatelessWidget {
  const RecommendationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trade Recommendations'),
      ),
      body: BlocBuilder<ValuationsBloc, ValuationsState>(
        builder: (context, state) {
          if (state is ValuationsLoading) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          if (state is NoRecommendations) {
            return const _EmptyState();
          }

          if (state is ValuationsLoaded) {
            if (state.active.isEmpty) {
              return const _EmptyState();
            }

            return ListView.builder(
              padding: const EdgeInsets.all(16.0),
              itemCount: state.active.length,
              itemBuilder: (context, index) {
                return _RecommendationCard(
                  recommendation: state.active[index],
                );
              },
            );
          }

          // ValuationsInitial or unknown state
          return const _EmptyState();
        },
      ),
    );
  }
}

/// Empty state widget shown when there are no active trade setups.
class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.show_chart,
            size: 64,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
          ),
          const SizedBox(height: 16),
          Text(
            'No current trade setups',
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
        ],
      ),
    );
  }
}

/// A card displaying a single trade recommendation.
///
/// Shows symbol, asset name, direction (BUY/SHORT) with directional icon,
/// trade category with distinct neon color, R:R ratio, and price levels.
class _RecommendationCard extends StatelessWidget {
  final Recommendation recommendation;

  const _RecommendationCard({required this.recommendation});

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final categoryColor = _categoryColor(recommendation.category, brightness);
    final directionColor = _directionColor(recommendation.direction, brightness);
    final directionIcon = _directionIcon(recommendation.direction);
    final directionLabel = _directionLabel(recommendation.direction);

    return Card(
      margin: const EdgeInsets.only(bottom: 12.0),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row: Symbol + Name | Direction badge
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        recommendation.symbol,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        recommendation.assetName,
                        style: Theme.of(context).textTheme.bodyMedium,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                // Direction badge with icon for accessibility
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12.0,
                    vertical: 6.0,
                  ),
                  decoration: BoxDecoration(
                    color: directionColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8.0),
                    border: Border.all(color: directionColor, width: 1.5),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        directionIcon,
                        color: directionColor,
                        size: 18,
                        semanticLabel: directionLabel,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        directionLabel,
                        style: TextStyle(
                          color: directionColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            // Category chip + R:R
            Row(
              children: [
                // Trade category chip with distinct neon color
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10.0,
                    vertical: 4.0,
                  ),
                  decoration: BoxDecoration(
                    color: categoryColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12.0),
                  ),
                  child: Text(
                    recommendation.category.label,
                    style: TextStyle(
                      color: categoryColor,
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                // R:R ratio
                Text(
                  recommendation.rewardRisk.formatted,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Divider(height: 1),
            const SizedBox(height: 12),
            // Price levels: Entry, Stop Loss, Target
            _PriceLevelsRow(recommendation: recommendation),
          ],
        ),
      ),
    );
  }

  /// Returns a distinct neon color for each trade category.
  Color _categoryColor(TradeCategory category, Brightness brightness) {
    switch (category) {
      case TradeCategory.dayTrade:
        // Neon cyan/accent for day trades
        return NeonColors.accent(brightness);
      case TradeCategory.swingTrade:
        // Neon green for swing trades
        return NeonColors.buyGreen(brightness);
      case TradeCategory.positionTrade:
        // Neon magenta/purple for position trades
        return brightness == Brightness.dark
            ? const Color(0xFFE040FB) // neon magenta (dark)
            : const Color(0xFF7B1FA2); // deeper purple (light, contrast-safe)
    }
  }

  /// Returns the directional color for buy/short.
  Color _directionColor(TradeDirection direction, Brightness brightness) {
    switch (direction) {
      case TradeDirection.buy:
        return NeonColors.buyGreen(brightness);
      case TradeDirection.short_:
        return NeonColors.shortRed(brightness);
    }
  }

  /// Returns a directional icon for buy/short (accessibility: icon + color).
  IconData _directionIcon(TradeDirection direction) {
    switch (direction) {
      case TradeDirection.buy:
        return Icons.arrow_upward;
      case TradeDirection.short_:
        return Icons.arrow_downward;
    }
  }

  /// Returns the text label for direction.
  String _directionLabel(TradeDirection direction) {
    switch (direction) {
      case TradeDirection.buy:
        return 'BUY';
      case TradeDirection.short_:
        return 'SHORT';
    }
  }
}

/// Row displaying entry, stop loss, and target price levels.
class _PriceLevelsRow extends StatelessWidget {
  final Recommendation recommendation;

  const _PriceLevelsRow({required this.recommendation});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final labelStyle = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
    );
    final valueStyle = theme.textTheme.bodyMedium?.copyWith(
      fontWeight: FontWeight.w600,
    );

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        _PriceColumn(
          label: 'Entry',
          value: recommendation.entryPrice.toStringAsFixed(2),
          labelStyle: labelStyle,
          valueStyle: valueStyle,
        ),
        _PriceColumn(
          label: 'Stop Loss',
          value: recommendation.stopLossPrice.toStringAsFixed(2),
          labelStyle: labelStyle,
          valueStyle: valueStyle,
        ),
        _PriceColumn(
          label: 'Target',
          value: recommendation.targetPrice.toStringAsFixed(2),
          labelStyle: labelStyle,
          valueStyle: valueStyle,
        ),
      ],
    );
  }
}

/// A single price column showing label above value.
class _PriceColumn extends StatelessWidget {
  final String label;
  final String value;
  final TextStyle? labelStyle;
  final TextStyle? valueStyle;

  const _PriceColumn({
    required this.label,
    required this.value,
    this.labelStyle,
    this.valueStyle,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(label, style: labelStyle),
        const SizedBox(height: 4),
        Text('\$$value', style: valueStyle),
      ],
    );
  }
}
