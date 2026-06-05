#include <bits/stdc++.h>
using namespace std;

class MedianFinder {
private:
    priority_queue<long long> lower; // Max Heap
    priority_queue<long long,
                   vector<long long>,
                   greater<long long>> upper; // Min Heap

    void rebalance() {
        if (lower.size() > upper.size() + 1) {
            upper.push(lower.top());
            lower.pop();
        }
        else if (upper.size() > lower.size()) {
            lower.push(upper.top());
            upper.pop();
        }
    }

public:
    MedianFinder() = default;

    void addNum(long long num) {
        if (lower.empty() || num <= lower.top()) {
            lower.push(num);
        } else {
            upper.push(num);
        }

        rebalance();
    }

    double getMedian() const {
        if (empty()) {
            throw runtime_error("No elements present");
        }

        if (lower.size() == upper.size()) {
            return (lower.top() + upper.top()) / 2.0;
        }

        return lower.top();
    }

    size_t size() const {
        return lower.size() + upper.size();
    }

    bool empty() const {
        return size() == 0;
    }

    void printState() const {
        cout << "\nCurrent Median: " << getMedian() << '\n';
        cout << "Elements Processed: " << size() << '\n';
    }
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    MedianFinder mf;

    int n;
    cout << "Enter number of elements: ";
    cin >> n;

    cout << "\nEnter elements:\n";

    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;

        mf.addNum(x);

        cout << "After inserting " << x
             << ", median = "
             << mf.getMedian()
             << '\n';
    }

    cout << "\nFinal Median = "
         << mf.getMedian()
         << '\n';

    return 0;
}
