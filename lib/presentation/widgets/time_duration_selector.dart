import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/models/enums.dart';
import '../blocs/chart_bloc.dart';
import '../theme/neon_theme.dart';

/// A horizontally scrollable row of chip buttons for selecting a chart time
/// duration. Displays all 14 [TimeDuration] options, highlights the active
/// selection with the neon accent color, and dispatches [ChangeDuration] events
/// to the [ChartBloc].
///
/// Shows a loading indicator overlay when chart data is being fetched and
/// displays an error message on load failure while retaining previous data.
class TimeDurationSelector extends StatelessWidget {
  const TimeDurationSelector({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChartBloc, ChartState>(
      builder: (context, state) {
        final selectedDuration = _selectedDuration(state);
        final isLoading = state is ChartLoading;
        final errorMessage = state is ChartError ? state.message : null;

        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 48,
              child: Stack(
                children: [
                  _buildDurationChips(context, selectedDuration),
                  if (isLoading) _buildLoadingOverlay(),
                ],
              ),
            ),
            if (errorMessage != null) _buildErrorMessage(context, errorMessage),
          ],
        );
      },
    );
  }

  /// Extracts the currently selected [TimeDuration] from the bloc state.
  TimeDuration _selectedDuration(ChartState state) {
    if (state is ChartLoading) return state.duration;
    if (state is ChartLoaded) return state.duration;
    if (state is ChartError) return state.duration;
    if (state is InsufficientData) return state.duration;
    // Default for ChartInitial
    return TimeDuration.twentyFourHour;
  }

  /// Builds the horizontally scrollable row of duration chips.
  Widget _buildDurationChips(BuildContext context, TimeDuration selected) {
    final brightness = Theme.of(context).brightness;
    final accentColor = NeonColors.accent(brightness);
    final surfaceColor = brightness == Brightness.dark
        ? NeonColors.darkSurface
        : NeonColors.lightSurface;
    final unselectedTextColor = brightness == Brightness.dark
        ? NeonColors.darkOnSurface
        : NeonColors.lightOnSurface;

    return ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      itemCount: TimeDuration.values.length,
      separatorBuilder: (_, __) => const SizedBox(width: 8),
      itemBuilder: (context, index) {
        final duration = TimeDuration.values[index];
        final isSelected = duration == selected;

        return _DurationChip(
          label: duration.label,
          isSelected: isSelected,
          accentColor: accentColor,
          surfaceColor: surfaceColor,
          unselectedTextColor: unselectedTextColor,
          onTap: () {
            context.read<ChartBloc>().add(ChangeDuration(duration));
          },
        );
      },
    );
  }

  /// Builds a subtle loading indicator overlaid on the selector.
  Widget _buildLoadingOverlay() {
    return const Positioned.fill(
      child: Align(
        alignment: Alignment.centerRight,
        child: Padding(
          padding: EdgeInsets.only(right: 8),
          child: SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
    );
  }

  /// Builds an error message below the selector row.
  Widget _buildErrorMessage(BuildContext context, String message) {
    final brightness = Theme.of(context).brightness;
    final errorColor = NeonColors.shortRed(brightness);

    return Padding(
      padding: const EdgeInsets.only(left: 12, top: 4),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 14, color: errorColor),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              'Failed to load chart data',
              style: TextStyle(fontSize: 12, color: errorColor),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// A single duration chip button with neon highlight styling.
class _DurationChip extends StatelessWidget {
  final String label;
  final bool isSelected;
  final Color accentColor;
  final Color surfaceColor;
  final Color unselectedTextColor;
  final VoidCallback onTap;

  const _DurationChip({
    required this.label,
    required this.isSelected,
    required this.accentColor,
    required this.surfaceColor,
    required this.unselectedTextColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: isSelected
                ? accentColor.withValues(alpha: 0.15)
                : surfaceColor,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isSelected ? accentColor : Colors.transparent,
              width: 1.5,
            ),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: accentColor.withValues(alpha: 0.4),
                      blurRadius: 8,
                      spreadRadius: 1,
                    ),
                  ]
                : null,
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              color: isSelected ? accentColor : unselectedTextColor,
            ),
          ),
        ),
      ),
    );
  }
}
