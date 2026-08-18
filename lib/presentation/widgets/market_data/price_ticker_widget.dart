import 'package:flutter/material.dart';

import '../../../domain/models/asset_price.dart';
import '../../theme/neon_theme.dart';
import 'percentage_display_helper.dart';

/// A stateless widget displaying a single asset's price ticker.
///
/// Shows the asset symbol, current price (2 decimal places), and percentage
/// change with directional color/icon. Handles loading, unavailable, and
/// stale data states.
class PriceTickerWidget extends StatelessWidget {
  /// The current price data for the asset, or null if not yet loaded.
  final AssetPrice? price;

  /// Whether the cached price data is stale (older than threshold).
  final bool isStale;

  /// Whether this symbol's data is unavailable (no response after timeout).
  final bool isUnavailable;

  /// Callback when the widget is tapped (navigate to asset detail).
  final VoidCallback? onTap;

  const PriceTickerWidget({
    super.key,
    this.price,
    this.isStale = false,
    this.isUnavailable = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12.0),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(12.0),
        ),
        child: _buildContent(context),
      ),
    );
  }

  /// Builds the appropriate content based on the widget's state.
  Widget _buildContent(BuildContext context) {
    if (isUnavailable) {
      return _buildUnavailablePlaceholder(context);
    }

    if (price == null) {
      return _buildLoadingPlaceholder(context);
    }

    return _buildPriceTicker(context, price!);
  }

  /// Builds the full price ticker display with symbol, price, and change.
  Widget _buildPriceTicker(BuildContext context, AssetPrice assetPrice) {
    final brightness = Theme.of(context).brightness;
    final display = getTickerPercentageDisplay(assetPrice.percentageChange);

    final Color directionColor;
    if (assetPrice.percentageChange > 0) {
      directionColor = NeonColors.buyGreen(brightness);
    } else if (assetPrice.percentageChange < 0) {
      directionColor = NeonColors.shortRed(brightness);
    } else {
      directionColor = Theme.of(context).colorScheme.onSurface;
    }

    return Row(
      children: [
        // Symbol
        Expanded(
          flex: 2,
          child: Text(
            assetPrice.symbol,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
        ),

        // Price
        Expanded(
          flex: 2,
          child: Text(
            '\$${assetPrice.price.toStringAsFixed(2)}',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
            textAlign: TextAlign.end,
          ),
        ),

        const SizedBox(width: 12),

        // Percentage change with directional icon
        Expanded(
          flex: 2,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (display.icon != null)
                Icon(display.icon, color: directionColor, size: 16),
              if (display.icon != null) const SizedBox(width: 2),
              Text(
                formatPercentageChange(assetPrice.percentageChange),
                style: TextStyle(
                  color: directionColor,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),

        // Stale indicator
        if (isStale) ...[
          const SizedBox(width: 8),
          Tooltip(
            message: 'Data may be stale',
            child: Icon(
              Icons.access_time,
              size: 16,
              color: Theme.of(context).colorScheme.onSurface.withValues(
                    alpha: 0.5,
                  ),
            ),
          ),
        ],
      ],
    );
  }

  /// Shows a loading shimmer/placeholder when price data hasn't arrived yet.
  Widget _buildLoadingPlaceholder(BuildContext context) {
    return Row(
      children: [
        // Symbol placeholder
        Container(
          width: 60,
          height: 16,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.onSurface.withValues(
                  alpha: 0.1,
                ),
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        const Spacer(),
        // Price placeholder
        Container(
          width: 80,
          height: 16,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.onSurface.withValues(
                  alpha: 0.1,
                ),
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        const SizedBox(width: 12),
        // Change placeholder
        Container(
          width: 60,
          height: 16,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.onSurface.withValues(
                  alpha: 0.1,
                ),
            borderRadius: BorderRadius.circular(4),
          ),
        ),
      ],
    );
  }

  /// Shows a "Data unavailable" placeholder for symbols with no data.
  Widget _buildUnavailablePlaceholder(BuildContext context) {
    return Row(
      children: [
        Icon(
          Icons.error_outline,
          size: 18,
          color: Theme.of(context).colorScheme.error,
        ),
        const SizedBox(width: 8),
        Text(
          'Data unavailable',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurface.withValues(
                      alpha: 0.6,
                    ),
              ),
        ),
      ],
    );
  }
}
