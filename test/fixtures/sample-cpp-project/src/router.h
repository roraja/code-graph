// Routing layer — determines which transport and destination to use for
// each message based on content, priority, and subscription topology.
// Implements Observer pattern for subscription notifications.

#ifndef ROUTER_H
#define ROUTER_H

#include "message.h"
#include "transport.h"
#include <unordered_map>
#include <unordered_set>
#include <functional>

// Route rule — maps a message pattern to a transport + destination
struct RouteRule {
  std::string pattern;          // Topic pattern (supports * wildcard)
  ITransport* transport;        // Transport to use
  std::string destination;      // Target endpoint
  Priority minPriority;         // Minimum priority to match this route
  bool exclusive;               // If true, stop routing after this match
};

// Subscription entry for pub/sub
struct Subscription {
  std::string subscriberId;
  std::string topicPattern;
  std::function<void(const Message&)> callback;
  bool active;
};

// Route outcome for diagnostics
struct RouteOutcome {
  std::string messageId;
  std::string ruleName;
  DeliveryResult result;
  int matchedRules;
};

// Observer interface for subscription lifecycle events
class ISubscriptionObserver {
public:
  virtual ~ISubscriptionObserver() = default;
  virtual void onSubscribe(const std::string& subscriberId, const std::string& topic) = 0;
  virtual void onUnsubscribe(const std::string& subscriberId, const std::string& topic) = 0;
  virtual void onDelivery(const std::string& subscriberId, const std::string& messageId, bool success) = 0;
};

// Message router — core routing engine
class MessageRouter {
public:
  MessageRouter();
  ~MessageRouter();

  // Route a message through matching rules
  std::vector<RouteOutcome> route(const Message& message, const std::string& topic);

  // Rule management
  void addRule(const RouteRule& rule);
  void removeRule(const std::string& pattern);
  void clearRules();
  size_t getRuleCount() const;

  // Pub/sub
  std::string subscribe(const std::string& subscriberId,
                         const std::string& topicPattern,
                         std::function<void(const Message&)> callback);
  void unsubscribe(const std::string& subscriptionId);
  size_t getSubscriptionCount() const;

  // Observer
  void addObserver(ISubscriptionObserver* observer);
  void removeObserver(ISubscriptionObserver* observer);

  // Dead letter queue for unroutable messages
  void enableDeadLetterQueue(ITransport* transport, const std::string& destination);
  size_t getDeadLetterCount() const;

private:
  std::vector<RouteRule> rules_;
  std::unordered_map<std::string, Subscription> subscriptions_;
  std::vector<ISubscriptionObserver*> observers_;

  ITransport* deadLetterTransport_;
  std::string deadLetterDestination_;
  bool deadLetterEnabled_;
  size_t deadLetterCount_;

  bool matchesPattern(const std::string& topic, const std::string& pattern) const;
  void notifySubscribers(const Message& message, const std::string& topic);
  void notifyObservers(const std::string& event,
                       const std::string& subscriberId,
                       const std::string& detail);
  void sendToDeadLetter(const Message& message, const std::string& reason);
};

// Logging observer — writes subscription events to stdout
class LoggingSubscriptionObserver : public ISubscriptionObserver {
public:
  void onSubscribe(const std::string& subscriberId, const std::string& topic) override;
  void onUnsubscribe(const std::string& subscriberId, const std::string& topic) override;
  void onDelivery(const std::string& subscriberId, const std::string& messageId, bool success) override;

  size_t getEventCount() const;

private:
  size_t eventCount_ = 0;
};

// Metrics observer — collects delivery stats
class MetricsObserver : public ISubscriptionObserver {
public:
  MetricsObserver();

  void onSubscribe(const std::string& subscriberId, const std::string& topic) override;
  void onUnsubscribe(const std::string& subscriberId, const std::string& topic) override;
  void onDelivery(const std::string& subscriberId, const std::string& messageId, bool success) override;

  size_t getTotalDeliveries() const;
  size_t getFailedDeliveries() const;
  double getSuccessRate() const;

private:
  size_t totalDeliveries_;
  size_t failedDeliveries_;
  std::unordered_set<std::string> activeSubscribers_;
};

#endif // ROUTER_H
