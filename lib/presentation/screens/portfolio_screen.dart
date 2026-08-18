import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/models/holding.dart';
import '../../domain/models/portfolio_summary.dart';
import '../blocs/portfolio_bloc.dart';
import '../theme/neon_theme.dart';

/// Portfolio screen displaying user holdings with current valuations.
///
/// Uses [PortfolioBloc] to manage state and displays holdings list,
/// empty state, stale data indicators, and an add-holding form.
class PortfolioScreen extends StatelessWidget {
  const PortfolioScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Portfolio'),
      ),
      body: BlocConsumer<PortfolioBloc, PortfolioState>(
        listener: (context, state) {
          if (state is PortfolioError) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
            );
          }
        },
        builder: (context, state) {
          if (state is PortfolioLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is PortfolioEmpty) {
            return _EmptyPortfolioView(
              onAddHolding: () => _showAddHoldingDialog(context),
            );
          }
          if (state is PortfolioLoaded) {
            return _PortfolioLoadedView(
              summary: state.summary,
              holdings: state.holdings,
              onAddHolding: () => _showAddHoldingDialog(context),
            );
          }
          // Fallback for PortfolioError — show empty with ability to retry.
          return _EmptyPortfolioView(
            onAddHolding: () => _showAddHoldingDialog(context),
          );
        },
      ),
      floatingActionButton: BlocBuilder<PortfolioBloc, PortfolioState>(
        builder: (context, state) {
          if (state is PortfolioLoaded) {
            return FloatingActionButton(
              onPressed: () => _showAddHoldingDialog(context),
              child: const Icon(Icons.add),
            );
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  void _showAddHoldingDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (_) => BlocProvider.value(
        value: context.read<PortfolioBloc>(),
        child: const _AddHoldingDialog(),
      ),
    );
  }
}

/// Displayed when the portfolio has no holdings.
class _EmptyPortfolioView extends StatelessWidget {
  final VoidCallback onAddHolding;

  const _EmptyPortfolioView({required this.onAddHolding});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final brightness = theme.brightness;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.account_balance_wallet_outlined,
              size: 64,
              color: NeonColors.accent(brightness),
            ),
            const SizedBox(height: 16),
            Text(
              'No holdings yet',
              style: theme.textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              'Add an asset to start tracking your portfolio.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onAddHolding,
              icon: const Icon(Icons.add),
              label: const Text('Add Holding'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Main view when portfolio has holdings.
class _PortfolioLoadedView extends StatelessWidget {
  final PortfolioSummary summary;
  final List<Holding> holdings;
  final VoidCallback onAddHolding;

  const _PortfolioLoadedView({
    required this.summary,
    required this.holdings,
    required this.onAddHolding,
  });

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;

    return Column(
      children: [
        // Portfolio summary header
        _PortfolioSummaryHeader(summary: summary),
        const Divider(height: 1),
        // Holdings list
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: 8.0),
            itemCount: summary.holdings.length,
            itemBuilder: (context, index) {
              final valuation = summary.holdings[index];
              return _HoldingCard(
                valuation: valuation,
                brightness: brightness,
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Summary header showing total portfolio value and gain/loss.
class _PortfolioSummaryHeader extends StatelessWidget {
  final PortfolioSummary summary;

  const _PortfolioSummaryHeader({required this.summary});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final brightness = theme.brightness;
    final gainLossColor = summary.totalGainLoss >= 0
        ? NeonColors.buyGreen(brightness)
        : NeonColors.shortRed(brightness);

    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Total Value',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 4),
          Text(
            '\$${summary.totalValue.toStringAsFixed(2)}',
            style: theme.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(
                summary.totalGainLoss >= 0
                    ? Icons.arrow_upward
                    : Icons.arrow_downward,
                size: 16,
                color: gainLossColor,
              ),
              const SizedBox(width: 4),
              Text(
                '\$${summary.totalGainLoss.abs().toStringAsFixed(2)}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: gainLossColor,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 4),
              Text(
                summary.totalGainLoss >= 0 ? 'gain' : 'loss',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: gainLossColor,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Card displaying a single holding's details.
class _HoldingCard extends StatelessWidget {
  final HoldingValuation valuation;
  final Brightness brightness;

  const _HoldingCard({
    required this.valuation,
    required this.brightness,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final holding = valuation.holding;
    final gainLossColor = valuation.unrealizedGainLoss >= 0
        ? NeonColors.buyGreen(brightness)
        : NeonColors.shortRed(brightness);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Symbol and stale indicator row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  holding.symbol,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (_isStaleData(holding))
                  _StaleDataIndicator(lastUpdate: holding.lastPriceUpdate!),
              ],
            ),
            const SizedBox(height: 12),
            // Details grid
            Row(
              children: [
                Expanded(
                  child: _DetailItem(
                    label: 'Quantity',
                    value: holding.quantity.toStringAsFixed(2),
                  ),
                ),
                Expanded(
                  child: _DetailItem(
                    label: 'Current Price',
                    value: holding.currentPrice != null
                        ? '\$${holding.currentPrice!.toStringAsFixed(2)}'
                        : '--',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: _DetailItem(
                    label: 'Total Value',
                    value: '\$${valuation.totalValue.toStringAsFixed(2)}',
                  ),
                ),
                Expanded(
                  child: _DetailItem(
                    label: 'Unrealized G/L',
                    value:
                        '\$${valuation.unrealizedGainLoss.abs().toStringAsFixed(2)}',
                    valueColor: gainLossColor,
                    prefix: valuation.unrealizedGainLoss >= 0
                        ? Icons.arrow_upward
                        : Icons.arrow_downward,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Returns true if the price data is stale (older than 60 seconds).
  bool _isStaleData(Holding holding) {
    if (holding.lastPriceUpdate == null) return false;
    final elapsed = DateTime.now().difference(holding.lastPriceUpdate!);
    return elapsed.inSeconds > 60;
  }
}

/// Small indicator showing elapsed time since last price update.
class _StaleDataIndicator extends StatelessWidget {
  final DateTime lastUpdate;

  const _StaleDataIndicator({required this.lastUpdate});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final elapsed = DateTime.now().difference(lastUpdate);
    final elapsedText = _formatElapsed(elapsed);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
      decoration: BoxDecoration(
        color: theme.colorScheme.error.withAlpha(30),
        borderRadius: BorderRadius.circular(4.0),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.warning_amber_rounded,
            size: 14,
            color: theme.colorScheme.error,
          ),
          const SizedBox(width: 4),
          Text(
            'Updated $elapsedText ago',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  String _formatElapsed(Duration elapsed) {
    if (elapsed.inHours > 0) {
      return '${elapsed.inHours}h ${elapsed.inMinutes % 60}m';
    }
    return '${elapsed.inMinutes}m';
  }
}

/// A labeled detail item used in holding cards.
class _DetailItem extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final IconData? prefix;

  const _DetailItem({
    required this.label,
    required this.value,
    this.valueColor,
    this.prefix,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 2),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (prefix != null) ...[
              Icon(prefix, size: 14, color: valueColor),
              const SizedBox(width: 2),
            ],
            Text(
              value,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: valueColor,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Dialog for adding a new holding to the portfolio.
class _AddHoldingDialog extends StatefulWidget {
  const _AddHoldingDialog();

  @override
  State<_AddHoldingDialog> createState() => _AddHoldingDialogState();
}

class _AddHoldingDialogState extends State<_AddHoldingDialog> {
  final _formKey = GlobalKey<FormState>();
  final _symbolController = TextEditingController();
  final _quantityController = TextEditingController();
  final _priceController = TextEditingController();

  String? _symbolError;
  String? _quantityError;
  String? _priceError;

  @override
  void dispose() {
    _symbolController.dispose();
    _quantityController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add Holding'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _symbolController,
                decoration: InputDecoration(
                  labelText: 'Symbol',
                  hintText: 'e.g. AAPL',
                  errorText: _symbolError,
                ),
                textCapitalization: TextCapitalization.characters,
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Symbol is required';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _quantityController,
                decoration: InputDecoration(
                  labelText: 'Quantity',
                  hintText: 'e.g. 10.5',
                  errorText: _quantityError,
                ),
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Quantity is required';
                  }
                  final qty = double.tryParse(value);
                  if (qty == null) {
                    return 'Enter a valid number';
                  }
                  if (qty < 0.0001 || qty > 999999999) {
                    return 'Must be between 0.0001 and 999,999,999';
                  }
                  // Check up to 4 decimal places
                  final parts = value.split('.');
                  if (parts.length == 2 && parts[1].length > 4) {
                    return 'Max 4 decimal places';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _priceController,
                decoration: InputDecoration(
                  labelText: 'Average Purchase Price',
                  hintText: 'e.g. 150.00',
                  prefixText: '\$ ',
                  errorText: _priceError,
                ),
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Price is required';
                  }
                  final price = double.tryParse(value);
                  if (price == null) {
                    return 'Enter a valid number';
                  }
                  if (price < 0.01 || price > 999999999.99) {
                    return 'Must be between \$0.01 and \$999,999,999.99';
                  }
                  // Check up to 2 decimal places
                  final parts = value.split('.');
                  if (parts.length == 2 && parts[1].length > 2) {
                    return 'Max 2 decimal places';
                  }
                  return null;
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        BlocListener<PortfolioBloc, PortfolioState>(
          listener: (context, state) {
            if (state is PortfolioLoaded) {
              Navigator.of(context).pop();
            }
            if (state is PortfolioError) {
              // Parse field-specific errors from the BLoC error message
              _parseAndSetErrors(state.message);
            }
          },
          child: ElevatedButton(
            onPressed: _submitForm,
            child: const Text('Add'),
          ),
        ),
      ],
    );
  }

  void _submitForm() {
    // Clear previous backend errors
    setState(() {
      _symbolError = null;
      _quantityError = null;
      _priceError = null;
    });

    if (_formKey.currentState?.validate() ?? false) {
      final symbol = _symbolController.text.trim().toUpperCase();
      final quantity = double.parse(_quantityController.text.trim());
      final price = double.parse(_priceController.text.trim());

      context.read<PortfolioBloc>().add(
            AddHolding(symbol: symbol, quantity: quantity, price: price),
          );
    }
  }

  void _parseAndSetErrors(String errorMessage) {
    setState(() {
      final lower = errorMessage.toLowerCase();
      if (lower.contains('symbol')) {
        _symbolError = errorMessage;
      } else if (lower.contains('quantity')) {
        _quantityError = errorMessage;
      } else if (lower.contains('price')) {
        _priceError = errorMessage;
      } else {
        // Generic error — show on symbol field as fallback
        _symbolError = errorMessage;
      }
    });
  }
}
