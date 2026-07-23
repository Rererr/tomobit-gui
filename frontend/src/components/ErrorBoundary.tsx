import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// クラスコンポーネントである理由: Error Boundary は getDerivedStateFromError /
// componentDidCatch を持つクラスでしか作れない（関数コンポーネント向けの
// フック相当は React に存在しない）。
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("予期しないエラーが発生した:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error === null) {
      return this.props.children;
    }
    return (
      <div className="error-boundary">
        <h2>予期しないエラーが発生した</h2>
        <p className="error-boundary-message">{this.state.error.message}</p>
        <button className="error-boundary-reload-btn" onClick={this.handleReload}>
          再読み込み
        </button>
      </div>
    );
  }
}
