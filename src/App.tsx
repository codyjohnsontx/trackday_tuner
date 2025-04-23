// import VehicleDisplay from './components/VehicleDisplay';
import Home from './components/Home';
import About from './components/About';
import Pricing from './components/Pricing';
import Bikes from './components/Bikes';
import NavBar from './components/NavBar';
import { Route, Routes } from 'react-router-dom';
import './App.css';

function App() {
  return (
    <>
      <NavBar />
      <div className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/bikes" element={<Bikes />} />
        </Routes>
      </div>
    </>
  );
}

export default App;
